/**
 * The Gateway is the central façade that wires every core module together and
 * implements the canonical request flow:
 *
 *   AgentAction
 *     -> budget check
 *     -> policy evaluation
 *     -> validation orchestration
 *     -> HITL (if required)
 *     -> tool execution (injected executor)
 *     -> cost charge + audit
 *
 * It is intentionally framework-agnostic. The MCP server and REST API wrap it.
 */
import { v4 as uuidv4 } from "uuid";
import type {
  AgentAction,
  AuditRecord,
  GovernanceDecision,
} from "../types/index.js";
import type { Logger } from "./logger.js";
import { PolicyEngine } from "./policy-engine/engine.js";
import { TraceStore } from "./traceability/store.js";
import { ValidationOrchestrator } from "./validation/orchestrator.js";
import { HitlGateway, ReviewProvider } from "./hitl/gateway.js";
import {
  BudgetController,
  MemoryBudgetStore,
  BudgetStore,
} from "./budget/controller.js";
import { MemoryTraceStore } from "./traceability/store.js";

export type ToolExecutor = (tool: string, params: Record<string, unknown>) => Promise<unknown>;

export interface GatewayDeps {
  policyEngine: PolicyEngine;
  traceStore: TraceStore;
  budgetController: BudgetController;
  validation?: ValidationOrchestrator;
  hitl?: HitlGateway;
  executor: ToolExecutor;
  logger: Logger;
}

export interface GatewayResult {
  decision: GovernanceDecision;
  result?: unknown;
  audit: AuditRecord;
  costUsd?: number;
}

export interface GatewayContext {
  /** Iteration count for the current task (used by `max-iterations` policy). */
  iteration?: number;
}

export class Gateway {
  constructor(private readonly deps: GatewayDeps) {}

  async process(
    partial: Omit<AgentAction, "id" | "timestamp"> & { id?: string; timestamp?: string },
    ctx: GatewayContext = {},
  ): Promise<GatewayResult> {
    const action: AgentAction = {
      id: partial.id ?? uuidv4(),
      agentId: partial.agentId,
      sessionId: partial.sessionId,
      tool: partial.tool,
      params: partial.params ?? {},
      prompt: partial.prompt ?? "",
      model: partial.model,
      timestamp: partial.timestamp ?? new Date().toISOString(),
      iteration: partial.iteration,
      parentActionId: partial.parentActionId,
    };

    // 1. Budget pre-check (estimation).
    const budgetCheck = await this.deps.budgetController.check(action);
    let decision: GovernanceDecision = {
      action: "allow",
      reason: budgetCheck.allowed ? "Budget ok" : budgetCheck.reason ?? "Budget check failed",
    };
    if (!budgetCheck.allowed) {
      decision = { action: "deny", reason: budgetCheck.reason ?? "Budget exceeded", policyId: "budget" };
      const audit = await this.deps.traceStore.record(action, decision);
      return { decision, audit, costUsd: budgetCheck.estimatedCostUsd };
    }

    // 2. Policy evaluation.
    decision = await this.deps.policyEngine.evaluate(
      action,
      {
        dailyCostUsd: (await this.deps.budgetController.snapshot(action.agentId)).dailyCostUsd,
        monthlyCostUsd: (await this.deps.budgetController.snapshot(action.agentId)).monthlyCostUsd,
      },
      ctx.iteration ?? partial.iteration ?? 0,
    );

    // 3. Validation orchestration (only when the policy would otherwise allow).
    if (decision.action === "allow" && this.deps.validation) {
      const result = await this.deps.validation.run(action);
      const failed = result.results.find((r) => !r.passed);
      if (failed) {
        decision = {
          action: "deny",
          reason: `Validation "${failed.checker}" failed: ${failed.summary}`,
          policyId: "validation",
        };
      }
    }

    // 4. HITL when the policy asks for review.
    if (decision.action === "require_review") {
      if (!this.deps.hitl) {
        decision = {
          action: "deny",
          reason: "Review required but no HITL gateway configured",
          policyId: decision.policyId,
        };
      } else {
        const review = await this.deps.hitl.requestReview(action, decision);
        if (review.status === "approved" && this.deps.hitl.verifyExecution(review, action)) {
          decision = { action: "allow", reason: `Approved by ${review.decidedBy}`, policyId: decision.policyId };
        } else {
          decision = {
            action: "deny",
            reason: `Review ${review.status} (by ${review.decidedBy ?? "n/a"})`,
            policyId: decision.policyId,
          };
        }
      }
    }

    // 5. Execute or deny.
    let result: unknown;
    if (decision.action === "allow") {
      try {
        result = await this.deps.executor(action.tool, action.params);
      } catch (err) {
        decision = {
          action: "deny",
          reason: `Executor failed: ${(err as Error).message}`,
          policyId: "executor",
        };
      }
    }

    // 6. Charge cost and write audit trail (always, even for denials).
    let costUsd: number | undefined;
    if (decision.action === "allow") {
      const snapshot = await this.deps.budgetController.charge(action, budgetCheck.estimatedCostUsd);
      costUsd = snapshot.dailyCostUsd;
    }
    const audit = await this.deps.traceStore.record(action, decision);
    return { decision, result, audit, costUsd };
  }
}

/** Build a Gateway with sensible in-memory defaults, useful for tests. */
export function buildLocalGateway(opts: {
  executor: ToolExecutor;
  logger: Logger;
  policyEngine: PolicyEngine;
  reviewProvider?: ReviewProvider;
  validation?: ValidationOrchestrator;
  budgetStore?: BudgetStore;
  hitlTimeoutSeconds?: number;
}): Gateway {
  const budgetStore =
    opts.budgetStore ?? new MemoryBudgetStore(50, 1000);
  const budgetController = new BudgetController({
    store: budgetStore,
    defaultDailyLimitUsd: 50,
    defaultMonthlyLimitUsd: 1000,
    logger: opts.logger,
  });
  const hitl = opts.reviewProvider
    ? new HitlGateway({
        provider: opts.reviewProvider,
        timeoutSeconds: opts.hitlTimeoutSeconds ?? 5,
        logger: opts.logger,
      })
    : undefined;
  return new Gateway({
    policyEngine: opts.policyEngine,
    traceStore: new MemoryTraceStore(opts.logger),
    budgetController,
    validation: opts.validation,
    hitl,
    executor: opts.executor,
    logger: opts.logger,
  });
}
/**
 * Public façade for the policy engine.
 *
 * `PolicyEngine` wires together an evaluator (OPA when available, JS fallback
 * otherwise), context building, and structured logging. It is the single
 * entry point used by the gateway, MCP server, and API.
 */
import type {
  AgentAction,
  GovernanceDecision,
  PolicyContext,
} from "../../types/index.js";
import type { Logger } from "../logger.js";
import {
  CompositeEvaluator,
  JsPolicyEvaluator,
  PolicyEvaluator,
  buildContext,
} from "./evaluator.js";
import { loadOpaEvaluator } from "./opa-loader.js";

export interface PolicyEngineOptions {
  policyDir: string;
  opaBundlePath?: string;
  fallbackToJsEvaluator: boolean;
  logger: Logger;
}

export class PolicyEngine {
  private evaluator: PolicyEvaluator;
  private readonly logger: Logger;

  private constructor(evaluator: PolicyEvaluator, logger: Logger) {
    this.evaluator = evaluator;
    this.logger = logger;
  }

  /**
   * Build a PolicyEngine. Prefers OPA when a bundle path is provided and the
   * bundle can be loaded; otherwise falls back to the JS evaluator (which is
   * always available and requires no external dependencies).
   */
  static async create(opts: PolicyEngineOptions): Promise<PolicyEngine> {
    const evaluators: PolicyEvaluator[] = [];
    if (opts.opaBundlePath) {
      const opa = await loadOpaEvaluator(opts.opaBundlePath, opts.logger);
      if (opa) evaluators.push(opa);
    }
    if (evaluators.length === 0 && opts.fallbackToJsEvaluator) {
      evaluators.push(new JsPolicyEvaluator());
    }
    const evaluator =
      evaluators.length === 1 ? evaluators[0] : new CompositeEvaluator(evaluators);
    opts.logger.info("PolicyEngine initialised", { evaluator: evaluator.name });
    return new PolicyEngine(evaluator, opts.logger);
  }

  /** Evaluate an action, building the context from current budget state. */
  async evaluate(
    action: AgentAction,
    budget: { dailyCostUsd: number; monthlyCostUsd: number },
    iterationCount: number,
  ): Promise<GovernanceDecision> {
    const ctx: PolicyContext = buildContext(action, budget, iterationCount);
    const decision = await this.evaluator.evaluate(action, ctx);
    this.logger.debug("Policy decision", {
      action: action.id,
      tool: action.tool,
      decision: decision.action,
      reason: decision.reason,
      evaluator: this.evaluator.name,
    });
    return decision;
  }

  /** Replace the active evaluator. Mainly used by tests. */
  _setEvaluatorForTest(evaluator: PolicyEvaluator): void {
    this.evaluator = evaluator;
  }

  get evaluatorName(): string {
    return this.evaluator.name;
  }
}
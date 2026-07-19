/**
 * Policy evaluation engine.
 *
 * The engine is pluggable: it prefers an OPA WASM bundle when available, and
 * falls back to an in-process TypeScript evaluator that mirrors the Rego
 * policies in `policies/`. Both code paths return the same `GovernanceDecision`
 * shape so callers do not need to care which one ran.
 *
 * This file contains the pure, side-effect-free evaluation logic. The OPA
 * loader lives in `opa-loader.ts`; persistence and logging in `engine.ts`.
 */
import type {
  AgentAction,
  GovernanceDecision,
  PolicyContext,
  PolicyRule,
  DecisionKind,
} from "../../types/index.js";
import { builtInRules, affectedPathsFrom } from "./rules.js";

export interface PolicyEvaluator {
  /** Evaluate a single action and return a decision. */
  evaluate(action: AgentAction, ctx: PolicyContext): Promise<GovernanceDecision>;
  /** Name of the evaluator, for logging / diagnostics. */
  readonly name: string;
}

/**
 * In-process TypeScript evaluator. Used when OPA is unavailable and as the
 * reference implementation that the Rego policies are validated against.
 */
export class JsPolicyEvaluator implements PolicyEvaluator {
  readonly name = "js-fallback";
  private readonly rules: PolicyRule[];

  constructor(rules: PolicyRule[] = builtInRules) {
    this.rules = rules;
  }

  async evaluate(action: AgentAction, ctx: PolicyContext): Promise<GovernanceDecision> {
    const fired: PolicyRule[] = [];
    for (const rule of this.rules) {
      try {
        if (rule.matches(action, ctx)) fired.push(rule);
      } catch (err) {
        // A broken rule must never silently allow a dangerous action.
        return {
          action: "require_review",
          reason: `Policy rule "${rule.id}" threw an error: ${(err as Error).message}`,
          policyId: rule.id,
        };
      }
    }

    const deny = fired.find((r) => r.severity === "deny");
    if (deny) {
      return { action: "deny", reason: deny.description, policyId: deny.id };
    }
    const review = fired.find((r) => r.severity === "review");
    if (review) {
      return {
        action: "require_review",
        reason: review.description,
        policyId: review.id,
        requireReview: {
          reviewers: ["lead-dev"],
          timeoutSeconds: 300,
          summary: review.description,
        },
      };
    }
    return { action: "allow", reason: "All policies passed" };
  }
}

/**
 * Combine multiple evaluators. The first that returns a non-allow decision
 * wins (deny > review > allow). Useful for "OPA + JS fallback" deployments.
 */
export class CompositeEvaluator implements PolicyEvaluator {
  readonly name: string;
  constructor(private readonly evaluators: PolicyEvaluator[]) {
    this.name = `composite[${evaluators.map((e) => e.name).join(",")}]`;
  }

  async evaluate(action: AgentAction, ctx: PolicyContext): Promise<GovernanceDecision> {
    let strongest: GovernanceDecision | null = null;
    let successes = 0;
    let lastError: Error | null = null;
    for (const evaluator of this.evaluators) {
      let decision: GovernanceDecision;
      try {
        decision = await evaluator.evaluate(action, ctx);
        successes++;
      } catch (err) {
        // A broken evaluator abstains; it must not crash the composite. The
        // remaining evaluators decide. If *all* evaluators fail we escalate.
        lastError = err as Error;
        continue;
      }
      if (decision.action === "deny") return decision;
      if (strongest === null || rank(decision.action) > rank(strongest.action)) {
        strongest = decision;
      }
    }
    if (successes === 0) {
      return {
        action: "require_review",
        reason: `All evaluators failed; last error: ${lastError?.message ?? "unknown"}`,
      };
    }
    return strongest ?? { action: "allow", reason: "No evaluators ran" };
  }
}

/** Severity ranking used by the composite evaluator. */
export function rank(kind: DecisionKind): number {
  switch (kind) {
    case "deny":
      return 2;
    case "require_review":
      return 1;
    case "allow":
      return 0;
  }
}

/** Build a PolicyContext for an action, given current budget state. */
export function buildContext(
  action: AgentAction,
  budget: { dailyCostUsd: number; monthlyCostUsd: number },
  iterationCount: number,
): PolicyContext {
  return {
    iterationCount,
    dailyCostUsd: budget.dailyCostUsd,
    monthlyCostUsd: budget.monthlyCostUsd,
    affectedPaths: affectedPathsFrom(action),
  };
}
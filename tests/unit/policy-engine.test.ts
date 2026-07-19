import { describe, it, expect } from "vitest";
import {
  JsPolicyEvaluator,
  CompositeEvaluator,
  PolicyEvaluator,
  rank,
} from "../../src/core/policy-engine/evaluator.js";
import type { AgentAction, GovernanceDecision, PolicyContext } from "../../src/types/index.js";
import { makeAction } from "../../src/core/traceability/store.js";

class Stub implements PolicyEvaluator {
  readonly name: string;
  constructor(name: string, private decision: GovernanceDecision) {
    this.name = name;
  }
  async evaluate(): Promise<GovernanceDecision> {
    return this.decision;
  }
}

class Failing implements PolicyEvaluator {
  readonly name = "failing";
  async evaluate(): Promise<GovernanceDecision> {
    throw new Error("boom");
  }
}

const ctx: PolicyContext = {
  iterationCount: 0,
  dailyCostUsd: 0,
  monthlyCostUsd: 0,
  affectedPaths: [],
};

const aAllow: GovernanceDecision = { action: "allow", reason: "ok" };
const aReview: GovernanceDecision = { action: "require_review", reason: "r" };
const aDeny: GovernanceDecision = { action: "deny", reason: "nope" };

describe("rank", () => {
  it("orders deny > require_review > allow", () => {
    expect(rank("deny")).toBeGreaterThan(rank("require_review"));
    expect(rank("require_review")).toBeGreaterThan(rank("allow"));
  });
});

describe("CompositeEvaluator", () => {
  it("returns deny as soon as any evaluator denies", async () => {
    const c = new CompositeEvaluator([new Stub("a", aAllow), new Stub("b", aDeny), new Stub("c", aReview)]);
    const d = await c.evaluate(makeAction({ agentId: "x", tool: "t" }), ctx);
    expect(d.action).toBe("deny");
  });

  it("returns require_review when only review fires", async () => {
    const c = new CompositeEvaluator([new Stub("a", aAllow), new Stub("b", aReview)]);
    const d = await c.evaluate(makeAction({ agentId: "x", tool: "t" }), ctx);
    expect(d.action).toBe("require_review");
  });

  it("returns allow when everything allows", async () => {
    const c = new CompositeEvaluator([new Stub("a", aAllow), new Stub("b", aAllow)]);
    const d = await c.evaluate(makeAction({ agentId: "x", tool: "t" }), ctx);
    expect(d.action).toBe("allow");
  });
});

describe("JsPolicyEvaluator error handling", () => {
  it("returns require_review when a rule throws", async () => {
    const badRule = {
      id: "bad",
      description: "broken",
      severity: "deny" as const,
      matches: () => {
        throw new Error("boom");
      },
    };
    const evaluator = new JsPolicyEvaluator([badRule]);
    const d = await evaluator.evaluate(makeAction({ agentId: "x", tool: "t" }), ctx);
    expect(d.action).toBe("require_review");
    expect(d.policyId).toBe("bad");
  });
});

describe("Failing evaluator inside composite", () => {
  it("does not crash the composite; another evaluator's decision wins", async () => {
    const c = new CompositeEvaluator([new Failing(), new JsPolicyEvaluator()]);
    const d = await c.evaluate(makeAction({ agentId: "x", tool: "write_file" }), ctx);
    expect(d.action).toBe("allow");
  });
});
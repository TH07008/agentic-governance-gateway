import { describe, it, expect } from "vitest";
import { builtInRules, affectedPathsFrom } from "../../src/core/policy-engine/rules.js";
import { JsPolicyEvaluator, buildContext } from "../../src/core/policy-engine/evaluator.js";
import { makeAction } from "../../src/core/traceability/store.js";
import type { AgentAction } from "../../src/types/index.js";

const safeContext = () => ({ iterationCount: 0, dailyCostUsd: 0, monthlyCostUsd: 0, affectedPaths: [] });

async function decide(action: AgentAction, ctx = safeContext()) {
  const evaluator = new JsPolicyEvaluator();
  return evaluator.evaluate(action, ctx);
}

describe("builtInRules", () => {
  it("registers at least eight rules covering deny + review", () => {
    const denyRules = builtInRules.filter((r) => r.severity === "deny");
    const reviewRules = builtInRules.filter((r) => r.severity === "review");
    expect(denyRules.length).toBeGreaterThanOrEqual(6);
    expect(reviewRules.length).toBeGreaterThanOrEqual(2);
  });

  it("every rule has a stable id and description", () => {
    for (const rule of builtInRules) {
      expect(rule.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(rule.description.length).toBeGreaterThan(10);
    }
  });
});

describe("JsPolicyEvaluator – allow cases", () => {
  it("allows a benign write_file", async () => {
    const d = await decide(makeAction({ agentId: "a", tool: "write_file", params: { path: "src/index.ts" } }));
    expect(d.action).toBe("allow");
  });

  it("allows a git_push to non-sensitive paths", async () => {
    const action = makeAction({ agentId: "a", tool: "git_push", params: { paths: ["src/foo.ts"] } });
    const ctx = { ...safeContext(), affectedPaths: affectedPathsFrom(action) };
    const d = await decide(action, ctx);
    expect(d.action).toBe("allow");
  });
});

describe("JsPolicyEvaluator – deny cases", () => {
  it("denies an SSN in the prompt", async () => {
    const d = await decide(makeAction({ agentId: "a", tool: "write_file", prompt: "Fix my SSN 123-45-6789" }));
    expect(d.action).toBe("deny");
    expect(d.policyId).toBe("no-prod-data-in-prompt");
  });

  it("denies an AWS access key id in params", async () => {
    const d = await decide(makeAction({ agentId: "a", tool: "write_file", params: { key: "AKIAIOSFODNN7EXAMPLE" } }));
    expect(d.action).toBe("deny");
    expect(d.policyId).toBe("no-aws-keys-in-prompt");
  });

  it("denies a hardcoded secret assignment", async () => {
    const d = await decide(
      makeAction({ agentId: "a", tool: "write_file", params: { content: 'api_key="abcdef0123456789"' } }),
    );
    expect(d.action).toBe("deny");
    expect(d.policyId).toBe("no-hardcoded-secrets");
  });

  it("denies DROP TABLE in execute_sql", async () => {
    const d = await decide(makeAction({ agentId: "a", tool: "execute_sql", params: { sql: "DROP TABLE users" } }));
    expect(d.action).toBe("deny");
    expect(d.policyId).toBe("no-direct-db-drop");
  });

  it("denies `rm -rf /` in bash", async () => {
    const d = await decide(makeAction({ agentId: "a", tool: "bash", params: { command: "rm -rf /" } }));
    expect(d.action).toBe("deny");
    expect(d.policyId).toBe("no-rmrf");
  });

  it("denies when iteration count exceeds 5", async () => {
    const action = makeAction({ agentId: "a", tool: "write_file" });
    const ctx = { ...safeContext(), iterationCount: 6 };
    const d = await decide(action, ctx);
    expect(d.action).toBe("deny");
    expect(d.policyId).toBe("max-iterations");
  });

  it("denies when daily budget is at or above the limit", async () => {
    const d = await decide(makeAction({ agentId: "a", tool: "write_file" }), {
      ...safeContext(),
      dailyCostUsd: 50,
    });
    expect(d.action).toBe("deny");
    expect(d.policyId).toBe("daily-budget-cap");
  });

  it("denies when monthly budget is at or above the limit", async () => {
    const d = await decide(makeAction({ agentId: "a", tool: "write_file" }), {
      ...safeContext(),
      monthlyCostUsd: 1000,
    });
    expect(d.action).toBe("deny");
    expect(d.policyId).toBe("monthly-budget-cap");
  });
});

describe("JsPolicyEvaluator – require_review cases", () => {
  it("requires review for openapi.yaml changes on git_push", async () => {
    const action = makeAction({ agentId: "a", tool: "git_push", params: { paths: ["src/openapi.yaml"] } });
    const ctx = { ...safeContext(), affectedPaths: affectedPathsFrom(action) };
    const d = await decide(action, ctx);
    expect(d.action).toBe("require_review");
    expect(d.requireReview?.reviewers).toContain("lead-dev");
  });

  it("requires review for production path changes on git_push", async () => {
    const action = makeAction({ agentId: "a", tool: "git_push", params: { paths: ["infra/prod/config.yaml"] } });
    const ctx = { ...safeContext(), affectedPaths: affectedPathsFrom(action) };
    const d = await decide(action, ctx);
    expect(d.action).toBe("require_review");
    expect(d.policyId).toBe("prod-path-change-requires-review");
  });
});

describe("affectedPathsFrom", () => {
  it("collects path, file, paths, files and changes[].path", () => {
    const action = makeAction({
      agentId: "a",
      tool: "x",
      params: {
        path: "a/b.ts",
        file: "c/d.ts",
        paths: ["e/f.ts"],
        files: ["g/h.ts"],
        changes: [{ path: "i/j.ts" }, { path: "k/l.ts" }],
      },
    });
    expect(affectedPathsFrom(action)).toEqual(["a/b.ts", "c/d.ts", "e/f.ts", "g/h.ts", "i/j.ts", "k/l.ts"]);
  });

  it("returns empty array for actions without path-like params", () => {
    expect(affectedPathsFrom(makeAction({ agentId: "a", tool: "x", params: { foo: 1 } }))).toEqual([]);
  });
});

describe("buildContext", () => {
  it("fills affectedPaths from the action", () => {
    const action = makeAction({ agentId: "a", tool: "git_push", params: { paths: ["x/y.ts"] } });
    const ctx = buildContext(action, { dailyCostUsd: 1, monthlyCostUsd: 2 }, 3);
    expect(ctx.affectedPaths).toEqual(["x/y.ts"]);
    expect(ctx.iterationCount).toBe(3);
    expect(ctx.dailyCostUsd).toBe(1);
    expect(ctx.monthlyCostUsd).toBe(2);
  });
});
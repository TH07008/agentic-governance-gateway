/**
 * Cross-implementation parity test.
 *
 * Verifies that the in-process TypeScript evaluator and the Rego policy set
 * produce the same decision for a wide set of inputs. Requires OPA to be
 * installed (the test is skipped automatically if `opa` is not on PATH).
 *
 * Run with: `npm run test:integration`
 * Run Rego tests directly with: `opa test policies/ -v`
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsPolicyEvaluator, buildContext } from "../../src/core/policy-engine/evaluator.js";
import { affectedPathsFrom } from "../../src/core/policy-engine/rules.js";
import { makeAction } from "../../src/core/traceability/store.js";
import type { AgentAction, GovernanceDecision } from "../../src/types/index.js";

function opaAvailable(): boolean {
  try {
    execFileSync("opa", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function opaEvaluate(input: unknown): GovernanceDecision {
  const dir = mkdtempSync(join(tmpdir(), "opa-parity-"));
  const inputPath = join(dir, "input.json");
  writeFileSync(inputPath, JSON.stringify(input));
  try {
    const out = execFileSync(
      "opa",
      ["eval", "-f", "json", "-d", "policies/agentic_gateway.rego", "-i", inputPath, "data.agentic_gateway.deny"],
      {},
    ).toString();
    const parsed = JSON.parse(out) as { result: { expressions: { value: string[] }[] }[] };
    const deny = parsed.result?.[0]?.expressions?.[0]?.value ?? [];
    if (deny.length > 0) return { action: "deny", reason: String(deny[0]), policyId: "opa" };
    const out2 = execFileSync(
      "opa",
      ["eval", "-f", "json", "-d", "policies/agentic_gateway.rego", "-i", inputPath, "data.agentic_gateway.require_review"],
      {},
    ).toString();
    const parsed2 = JSON.parse(out2) as { result: { expressions: { value: string[] }[] }[] };
    const review = parsed2.result?.[0]?.expressions?.[0]?.value ?? [];
    if (review.length > 0) {
      return {
        action: "require_review",
        reason: String(review[0]),
        policyId: "opa",
        requireReview: { reviewers: ["lead-dev"], timeoutSeconds: 300, summary: String(review[0]) },
      };
    }
    return { action: "allow", reason: "opa: no policies fired" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Case {
  name: string;
  action: AgentAction;
  iteration?: number;
  dailyCost?: number;
  monthlyCost?: number;
}

const cases: Case[] = [
  {
    name: "safe write_file",
    action: makeAction({ agentId: "a", tool: "write_file", params: { path: "src/index.ts" } }),
  },
  {
    name: "ssn in prompt",
    action: makeAction({ agentId: "a", tool: "write_file", prompt: "my SSN 123-45-6789" }),
  },
  {
    name: "aws key in params",
    action: makeAction({ agentId: "a", tool: "write_file", params: { key: "AKIAIOSFODNN7EXAMPLE" } }),
  },
  {
    name: "hardcoded secret",
    action: makeAction({ agentId: "a", tool: "write_file", params: { content: 'api_key="abcdef0123456789"' } }),
  },
  {
    name: "drop table",
    action: makeAction({ agentId: "a", tool: "execute_sql", params: { sql: "DROP TABLE users" } }),
  },
  {
    name: "rm -rf /",
    action: makeAction({ agentId: "a", tool: "bash", params: { command: "rm -rf /" } }),
  },
  {
    name: "max iterations",
    action: makeAction({ agentId: "a", tool: "write_file" }),
    iteration: 6,
  },
  {
    name: "daily budget cap",
    action: makeAction({ agentId: "a", tool: "write_file" }),
    dailyCost: 50,
  },
  {
    name: "openapi change",
    action: makeAction({ agentId: "a", tool: "git_push", params: { paths: ["src/openapi.yaml"] } }),
  },
  {
    name: "prod path change",
    action: makeAction({ agentId: "a", tool: "git_push", params: { paths: ["infra/prod/config.yaml"] } }),
  },
  {
    name: "non-sensitive git_push",
    action: makeAction({ agentId: "a", tool: "git_push", params: { paths: ["README.md"] } }),
  },
];

const js = new JsPolicyEvaluator();

describe.skipIf(!opaAvailable())("Policy parity (TS vs Rego)", () => {
  for (const c of cases) {
    it(`agrees on "${c.name}"`, async () => {
      const ctx = buildContext(
        c.action,
        { dailyCostUsd: c.dailyCost ?? 0, monthlyCostUsd: c.monthlyCost ?? 0 },
        c.iteration ?? 0,
      );
      const tsDecision = await js.evaluate(c.action, ctx);
      const regoInput = {
        action: { ...c.action, params: c.action.params ?? {} },
        context: {
          iterationCount: ctx.iterationCount,
          dailyCostUsd: ctx.dailyCostUsd,
          monthlyCostUsd: ctx.monthlyCostUsd,
          affectedPaths: affectedPathsFrom(c.action),
        },
      };
      const regoDecision = opaEvaluate(regoInput);
      expect(tsDecision.action).toBe(regoDecision.action);
    });
  }
});

describe("JsPolicyEvaluator is always available (parity baseline)", () => {
  it("evaluates the safe case", async () => {
    const d = await js.evaluate(cases[0].action, buildContext(cases[0].action, { dailyCostUsd: 0, monthlyCostUsd: 0 }, 0));
    expect(d.action).toBe("allow");
  });
});
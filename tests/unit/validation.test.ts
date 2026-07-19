import { describe, it, expect } from "vitest";
import {
  ValidationOrchestrator,
  StaticChecker,
  ScriptChecker,
} from "../../src/core/validation/orchestrator.js";
import { makeAction } from "../../src/core/traceability/store.js";
import type { AgentAction, ValidationResult } from "../../src/types/index.js";
import { CapturingLogger } from "../../src/core/logger.js";

const logger = new CapturingLogger();

function buildResult(partial: Partial<ValidationResult> & { checker: string }): ValidationResult {
  return { passed: true, summary: "ok", durationMs: 1, ...partial };
}

describe("StaticChecker", () => {
  it("returns the canned result when appliesTo is true", async () => {
    const c = new StaticChecker("demo", buildResult({ checker: "demo", passed: true, summary: "ok" }));
    const r = await c.run(makeAction({ agentId: "a", tool: "t" }));
    expect(r.passed).toBe(true);
  });

  it("skips when appliesTo returns false", async () => {
    const c = new StaticChecker(
      "demo",
      buildResult({ checker: "demo", passed: false }),
      (a: AgentAction) => a.tool === "other",
    );
    const action = makeAction({ agentId: "a", tool: "t" });
    expect(c.appliesTo(action)).toBe(false);
  });
});

describe("ScriptChecker", () => {
  it("passes when runner returns exit 0", async () => {
    const c = new ScriptChecker({
      name: "sh",
      command: () => "echo hi",
      runner: async () => ({ exitCode: 0, stdout: "hi", stderr: "" }),
    });
    const r = await c.run(makeAction({ agentId: "a", tool: "t" }));
    expect(r.passed).toBe(true);
    expect(r.findings?.some((f) => f.message.includes("hi"))).toBe(true);
  });

  it("fails when runner returns non-zero", async () => {
    const c = new ScriptChecker({
      name: "sh",
      command: () => "false",
      runner: async () => ({ exitCode: 1, stdout: "", stderr: "nope" }),
    });
    const r = await c.run(makeAction({ agentId: "a", tool: "t" }));
    expect(r.passed).toBe(false);
    expect(r.findings?.some((f) => f.severity === "error")).toBe(true);
  });

  it("returns a passed result when command returns null", async () => {
    const c = new ScriptChecker({
      name: "sh",
      command: () => null,
      runner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
    const r = await c.run(makeAction({ agentId: "a", tool: "t" }));
    expect(r.passed).toBe(true);
  });
});

describe("ValidationOrchestrator", () => {
  it("runs only applicable checkers", async () => {
    const called: string[] = [];
    const orch = new ValidationOrchestrator({
      logger,
      checkers: [
        new StaticChecker("only-write", buildResult({ checker: "only-write", passed: true }), (a) => a.tool === "write_file"),
        new StaticChecker("always", buildResult({ checker: "always", passed: true }), () => true),
      ],
    });
    const results = await orch.run(makeAction({ agentId: "a", tool: "git_push" }));
    expect(results.passed).toBe(true);
    expect(results.results.map((r) => r.checker)).toEqual(["always"]);
    void called;
  });

  it("fails the run when a checker errors in findings", async () => {
    const orch = new ValidationOrchestrator({
      logger,
      checkers: [
        new StaticChecker("bad", buildResult({ checker: "bad", passed: false, summary: "x", findings: [{ severity: "error", message: "boom" }] })),
      ],
    });
    const results = await orch.run(makeAction({ agentId: "a", tool: "t" }));
    expect(results.passed).toBe(false);
  });

  it("swallows checker exceptions and marks the result as failed", async () => {
    const throwing = {
      name: "throws",
      appliesTo: () => true,
      run: async (): Promise<ValidationResult> => {
        throw new Error("boom");
      },
    };
    const orch = new ValidationOrchestrator({ logger, checkers: [throwing] });
    const r = await orch.run(makeAction({ agentId: "a", tool: "t" }));
    expect(r.passed).toBe(false);
    expect(r.results[0].checker).toBe("throws");
  });
});
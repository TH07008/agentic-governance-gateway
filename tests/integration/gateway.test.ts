import { describe, it, expect, beforeEach } from "vitest";
import { Gateway } from "../../src/core/gateway.js";
import { PolicyEngine } from "../../src/core/policy-engine/engine.js";
import { MemoryTraceStore } from "../../src/core/traceability/store.js";
import { MemoryBudgetStore } from "../../src/core/budget/controller.js";
import { BudgetController } from "../../src/core/budget/controller.js";
import { ValidationOrchestrator, StaticChecker } from "../../src/core/validation/orchestrator.js";
import { HitlGateway, MemoryReviewProvider } from "../../src/core/hitl/gateway.js";
import { CapturingLogger, type Logger } from "../../src/core/logger.js";
import type { ToolExecutor } from "../../src/core/gateway.js";

async function buildGateway(opts: {
  executor?: ToolExecutor;
  validation?: ValidationOrchestrator;
  hitl?: HitlGateway;
  budget?: MemoryBudgetStore;
  logger?: Logger;
} = {}) {
  const logger = opts.logger ?? new CapturingLogger();
  const policyEngine = await PolicyEngine.create({
    policyDir: "./policies",
    fallbackToJsEvaluator: true,
    logger,
  });
  const traceStore = new MemoryTraceStore(logger);
  const budgetStore = opts.budget ?? new MemoryBudgetStore(50, 1000);
  const budgetController = new BudgetController({
    store: budgetStore,
    defaultDailyLimitUsd: 50,
    defaultMonthlyLimitUsd: 1000,
    logger,
  });
  return new Gateway({
    policyEngine,
    traceStore,
    budgetController,
    validation: opts.validation,
    hitl: opts.hitl,
    executor: opts.executor ?? (async (tool) => `exec:${tool}`),
    logger,
  });
}

describe("Gateway – allow path", () => {
  it("allows a benign write_file and runs the executor", async () => {
    const calls: string[] = [];
    const gw = await buildGateway({ executor: async (tool) => (calls.push(tool), `exec:${tool}`) });
    const result = await gw.process({
      agentId: "claude-code",
      sessionId: "s",
      tool: "write_file",
      params: { path: "src/index.ts" },
      prompt: "add a function",
      model: "test-model",
    });
    expect(result.decision.action).toBe("allow");
    expect(result.result).toBe("exec:write_file");
    expect(calls).toEqual(["write_file"]);
    expect(result.audit.action.id).toBeDefined();
  });

  it("writes an audit record for allowed actions", async () => {
    const gw = await buildGateway();
    const result = await gw.process({
      agentId: "claude-code",
      sessionId: "s",
      tool: "write_file",
      params: { path: "a.ts" },
      prompt: "",
      model: "test-model",
    });
    expect(result.audit.provenance["@context"]).toBe("https://www.w3.org/ns/prov");
  });
});

describe("Gateway – deny path", () => {
  it("denies a prompt containing an SSN and skips the executor", async () => {
    let executed = false;
    const gw = await buildGateway({ executor: async () => ((executed = true), "x") });
    const result = await gw.process({
      agentId: "a",
      sessionId: "s",
      tool: "write_file",
      params: {},
      prompt: "my SSN is 123-45-6789",
      model: "test-model",
    });
    expect(result.decision.action).toBe("deny");
    expect(result.decision.policyId).toBe("no-prod-data-in-prompt");
    expect(executed).toBe(false);
  });

  it("denies when budget check fails", async () => {
    const budget = new MemoryBudgetStore(1, 1000);
    budget._setDailyForTest("a", 0.99);
    const gw = await buildGateway({ budget });
    const result = await gw.process({
      agentId: "a",
      sessionId: "s",
      tool: "write_file",
      params: { path: "x.ts" },
      prompt: "x".repeat(100_000),
      model: "claude-3-opus",
    });
    expect(result.decision.action).toBe("deny");
    expect(result.decision.policyId).toBe("budget");
  });

  it("denies when a validation checker errors", async () => {
    const validation = new ValidationOrchestrator({
      logger: new CapturingLogger(),
      checkers: [
        new StaticChecker("semgrep", {
          checker: "semgrep",
          passed: false,
          summary: "1 finding",
          durationMs: 1,
          findings: [{ severity: "error", message: "sql injection" }],
        }),
      ],
    });
    const gw = await buildGateway({ validation });
    const result = await gw.process({
      agentId: "a",
      sessionId: "s",
      tool: "write_file",
      params: { path: "a.ts" },
      prompt: "",
      model: "test-model",
    });
    expect(result.decision.action).toBe("deny");
    expect(result.decision.policyId).toBe("validation");
  });
});

describe("Gateway – review path", () => {
  it("approves and executes when the reviewer approves", async () => {
    const hitl = new HitlGateway({
      provider: new MemoryReviewProvider(() => "approved"),
      timeoutSeconds: 5,
      logger: new CapturingLogger(),
    });
    const gw = await buildGateway({ hitl });
    const result = await gw.process({
      agentId: "a",
      sessionId: "s",
      tool: "git_push",
      params: { paths: ["openapi.yaml"] },
      prompt: "",
      model: "test-model",
    });
    expect(result.decision.action).toBe("allow");
    expect(result.decision.reason).toContain("Approved");
  });

  it("denies when the reviewer denies", async () => {
    const hitl = new HitlGateway({
      provider: new MemoryReviewProvider(() => "denied"),
      timeoutSeconds: 5,
      logger: new CapturingLogger(),
    });
    const gw = await buildGateway({ hitl });
    const result = await gw.process({
      agentId: "a",
      sessionId: "s",
      tool: "git_push",
      params: { paths: ["openapi.yaml"] },
      prompt: "",
      model: "test-model",
    });
    expect(result.decision.action).toBe("deny");
  });
});

describe("Gateway – executor failures", () => {
  it("records a deny when the executor throws", async () => {
    const gw = await buildGateway({
      executor: async () => {
        throw new Error("disk full");
      },
    });
    const result = await gw.process({
      agentId: "a",
      sessionId: "s",
      tool: "write_file",
      params: { path: "x.ts" },
      prompt: "",
      model: "test-model",
    });
    expect(result.decision.action).toBe("deny");
    expect(result.decision.policyId).toBe("executor");
    expect(result.decision.reason).toContain("disk full");
  });
});

describe("Gateway – chaining and iteration", () => {
  beforeEach(() => {
    // noop, just demonstrating lifecycle hooks exist
  });

  it("denies when iteration exceeds 5", async () => {
    const gw = await buildGateway();
    const result = await gw.process(
      {
        agentId: "a",
        sessionId: "s",
        tool: "write_file",
        params: { path: "x.ts" },
        prompt: "",
        model: "test-model",
      },
      { iteration: 6 },
    );
    expect(result.decision.action).toBe("deny");
    expect(result.decision.policyId).toBe("max-iterations");
  });
});
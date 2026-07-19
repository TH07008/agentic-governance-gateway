import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createServer, type Server } from "node:http";
import { PolicyEngine } from "../../src/core/policy-engine/engine.js";
import { MemoryTraceStore } from "../../src/core/traceability/store.js";
import { MemoryBudgetStore, BudgetController } from "../../src/core/budget/controller.js";
import { Gateway } from "../../src/core/gateway.js";
import { createLogger } from "../../src/core/logger.js";
import { startApiServer } from "../../src/api/server.js";

let server: Server;
const port = 43219;

async function json(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

beforeAll(async () => {
  const logger = createLogger("error");
  const policyEngine = await PolicyEngine.create({
    policyDir: "./policies",
    fallbackToJsEvaluator: true,
    logger,
  });
  const traceStore = new MemoryTraceStore(logger);
  const budgetController = new BudgetController({
    store: new MemoryBudgetStore(50, 1000),
    defaultDailyLimitUsd: 50,
    defaultMonthlyLimitUsd: 1000,
    logger,
  });
  const gateway = new Gateway({
    policyEngine,
    traceStore,
    budgetController,
    executor: async (tool) => `exec:${tool}`,
    logger,
  });
  server = await startApiServer({
    gateway,
    budgetController,
    traceStore,
    logger,
    port,
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("REST API", () => {
  it("GET /healthz returns ok", async () => {
    const r = await json("GET", "/healthz");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  it("GET /status/:agent returns a budget snapshot", async () => {
    const r = await json("GET", "/status/claude-code");
    expect(r.status).toBe(200);
    expect((r.body as { agentId: string }).agentId).toBe("claude-code");
    expect((r.body as { dailyLimitUsd: number }).dailyLimitUsd).toBe(50);
  });

  it("POST /process allows a benign action", async () => {
    const r = await json("POST", "/process", {
      agentId: "a",
      sessionId: "s",
      tool: "write_file",
      params: { path: "x.ts" },
      prompt: "",
      model: "test-model",
    });
    expect(r.status).toBe(200);
    const body = r.body as { decision: { action: string } };
    expect(body.decision.action).toBe("allow");
  });

  it("POST /process denies a dangerous prompt", async () => {
    const r = await json("POST", "/process", {
      agentId: "a",
      sessionId: "s",
      tool: "write_file",
      params: {},
      prompt: "SSN 123-45-6789",
      model: "test-model",
    });
    expect(r.status).toBe(200);
    const body = r.body as { decision: { action: string; policyId: string } };
    expect(body.decision.action).toBe("deny");
  });

  it("GET /audit/:id returns 404 for unknown ids", async () => {
    const r = await json("GET", "/audit/unknown-id");
    expect(r.status).toBe(404);
  });

  it("GET /audit/:id returns the recorded audit after /process", async () => {
    const process = await json("POST", "/process", {
      agentId: "a",
      sessionId: "s",
      tool: "write_file",
      params: { path: "y.ts" },
      prompt: "",
      model: "test-model",
    });
    const actionId = (process.body as { audit: { action: { id: string } } }).audit.action.id;
    const r = await json("GET", `/audit/${actionId}`);
    expect(r.status).toBe(200);
    expect((r.body as { action: { id: string } }).action.id).toBe(actionId);
  });

  it("returns 400 for invalid bodies", async () => {
    const r = await json("POST", "/process", { agentId: "" });
    expect(r.status).toBe(400);
  });

  it("returns 404 for unknown routes", async () => {
    const r = await json("GET", "/nope");
    expect(r.status).toBe(404);
  });
});
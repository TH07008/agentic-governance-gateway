/**
 * End-to-end test of the MCP tool handlers.
 *
 * We exercise `attachHandlers` by calling the registered handlers directly
 * through a minimal fake Server. No stdio, no LLM, no API keys required.
 */
import { describe, it, expect, vi } from "vitest";
import { attachHandlers, defineTools } from "../../src/mcp/server.js";
import { PolicyEngine } from "../../src/core/policy-engine/engine.js";
import { MemoryTraceStore } from "../../src/core/traceability/store.js";
import { MemoryBudgetStore, BudgetController } from "../../src/core/budget/controller.js";
import { Gateway } from "../../src/core/gateway.js";
import { CapturingLogger } from "../../src/core/logger.js";

interface HandlerMap {
  [key: string]: ((req: unknown) => Promise<unknown>) | undefined;
}

function fakeServer(): { server: unknown; handlers: HandlerMap; ordered: ((req: unknown) => Promise<unknown>)[] } {
  const handlers: HandlerMap = {};
  const ordered: ((req: unknown) => Promise<unknown>)[] = [];
  const server = {
    setRequestHandler: vi.fn((schema: unknown, handler: (req: unknown) => Promise<unknown>) => {
      const method = extractMethod(schema);
      if (method) handlers[method] = handler;
      // Always record in registration order so tests can find them even when
      // the schema's method name is not a simple string property.
      ordered.push(handler);
    }),
  };
  return { server, handlers, ordered };
}

function extractMethod(schema: unknown): string | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const s = schema as Record<string, unknown>;
  if (typeof s.method === "string") return s.method;
  // Zod schemas expose their shape via .shape; method is often a ZodLiteral.
  const shape = s.shape as Record<string, unknown> | undefined;
  if (shape && shape.method && typeof shape.method === "object") {
    const literal = (shape.method as { value?: unknown; _def?: { value?: unknown } }).value
      ?? (shape.method as { _def?: { value?: unknown } })._def?.value;
    if (typeof literal === "string") return literal;
  }
  return undefined;
}

async function buildDeps() {
  const logger = new CapturingLogger();
  const policyEngine = await PolicyEngine.create({
    policyDir: "./policies",
    fallbackToJsEvaluator: true,
    logger,
  });
  const traceStore = new MemoryTraceStore(logger);
  const budgetStore = new MemoryBudgetStore(50, 1000);
  const budgetController = new BudgetController({
    store: budgetStore,
    defaultDailyLimitUsd: 50,
    defaultMonthlyLimitUsd: 1000,
    logger,
  });
  const gateway = new Gateway({
    policyEngine,
    traceStore,
    budgetController,
    executor: async (tool, params) => `exec:${tool}:${JSON.stringify(params)}`,
    logger,
  });
  return { gateway, budgetController, traceStore, logger, name: "test", version: "0.0.0" };
}

describe("MCP defineTools", () => {
  it("exposes the three gateway tools", () => {
    const tools = defineTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "governed_tool_call",
      "governance_status",
      "governance_audit_lookup",
    ]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(10);
    }
  });
});

describe("MCP handlers", () => {
  it("governed_tool_call allows a benign action and returns the audit id", async () => {
    const { server, handlers, ordered } = fakeServer();
    const deps = await buildDeps();
    attachHandlers(server as never, deps);
    const listHandler = handlers["tools/list"] ?? ordered[0]!;
    const callHandler = handlers["tools/call"] ?? ordered[1]!;
    expect(typeof listHandler).toBe("function");
    expect(typeof callHandler).toBe("function");

    const list = (await listHandler({})) as { tools: { name: string }[] };
    expect(list.tools.map((t) => t.name)).toContain("governed_tool_call");

    const result = (await callHandler({
      params: {
        name: "governed_tool_call",
        arguments: {
          agentId: "claude-code",
          sessionId: "s1",
          tool: "write_file",
          params: { path: "src/index.ts" },
          prompt: "add a function",
          model: "test-model",
        },
      },
    })) as { content: { type: string; text: string }[]; isError?: boolean };

    expect(result.isError).toBe(false);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.decision.action).toBe("allow");
    expect(payload.actionId).toBeDefined();
  });

  it("governed_tool_call denies a dangerous prompt and reports isError", async () => {
    const { server, handlers, ordered } = fakeServer();
    const deps = await buildDeps();
    attachHandlers(server as never, deps);
    const callHandler = handlers["tools/call"] ?? ordered[1]!;
    const result = (await callHandler({
      params: {
        name: "governed_tool_call",
        arguments: {
          agentId: "claude-code",
          sessionId: "s1",
          tool: "write_file",
          params: {},
          prompt: "SSN 123-45-6789",
          model: "test-model",
        },
      },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.decision.action).toBe("deny");
  });

  it("governance_status returns a budget snapshot", async () => {
    const { server, handlers, ordered } = fakeServer();
    const deps = await buildDeps();
    attachHandlers(server as never, deps);
    const callHandler = handlers["tools/call"] ?? ordered[1]!;
    const result = (await callHandler({
      params: { name: "governance_status", arguments: { agentId: "claude-code" } },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(result.content[0].text);
    expect(payload.agentId).toBe("claude-code");
    expect(payload.dailyLimitUsd).toBe(50);
  });

  it("governance_audit_lookup returns the previously-recorded audit", async () => {
    const { server, handlers, ordered } = fakeServer();
    const deps = await buildDeps();
    attachHandlers(server as never, deps);
    const callHandler = handlers["tools/call"] ?? ordered[1]!;

    // First, create a record.
    const callResult = (await callHandler({
      params: {
        name: "governed_tool_call",
        arguments: {
          agentId: "a",
          sessionId: "s",
          tool: "write_file",
          params: { path: "x.ts" },
          prompt: "",
          model: "test-model",
        },
      },
    })) as { content: { text: string }[] };
    const actionId = JSON.parse(callResult.content[0].text).actionId;

    const lookup = (await callHandler({
      params: { name: "governance_audit_lookup", arguments: { actionId } },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(lookup.content[0].text);
    expect(payload.action.id).toBe(actionId);
  });

  it("returns isError for unknown tools", async () => {
    const { server, handlers, ordered } = fakeServer();
    const deps = await buildDeps();
    attachHandlers(server as never, deps);
    const callHandler = handlers["tools/call"] ?? ordered[1]!;
    const result = (await callHandler({
      params: { name: "nope", arguments: {} },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool");
  });

  it("returns isError for invalid arguments", async () => {
    const { server, handlers, ordered } = fakeServer();
    const deps = await buildDeps();
    attachHandlers(server as never, deps);
    const callHandler = handlers["tools/call"] ?? ordered[1]!;
    const result = (await callHandler({
      params: { name: "governed_tool_call", arguments: { agentId: "" } },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Error/i);
  });
});
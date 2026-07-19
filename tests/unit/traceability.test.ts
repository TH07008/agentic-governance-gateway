import { describe, it, expect } from "vitest";
import { MemoryTraceStore, buildProvenance, makeAction } from "../../src/core/traceability/store.js";
import type { GovernanceDecision } from "../../src/types/index.js";
import { CapturingLogger } from "../../src/core/logger.js";

const allow: GovernanceDecision = { action: "allow", reason: "ok" };

describe("buildProvenance", () => {
  it("produces a W3C PROV-O compatible object", () => {
    const action = makeAction({ agentId: "claude-code", tool: "write_file", model: "claude-3-opus" });
    const prov = buildProvenance(action);
    expect(prov["@context"]).toBe("https://www.w3.org/ns/prov");
    expect(prov.entity.type).toBe("AgentAction");
    expect(prov.agent.type).toBe("SoftwareAgent");
    expect(prov.agent.label).toContain("claude-code");
  });
});

describe("MemoryTraceStore", () => {
  it("records and retrieves an action by id", async () => {
    const store = new MemoryTraceStore(new CapturingLogger());
    const action = makeAction({ agentId: "a", tool: "write_file" });
    const record = await store.record(action, allow);
    expect(record.decision.action).toBe("allow");
    const got = await store.get(action.id);
    expect(got?.action.id).toBe(action.id);
  });

  it("returns null for unknown ids", async () => {
    const store = new MemoryTraceStore(new CapturingLogger());
    expect(await store.get("nope")).toBeNull();
  });

  it("lists records and supports filtering by agentId/sessionId/tool/decision", async () => {
    const store = new MemoryTraceStore(new CapturingLogger());
    await store.record(makeAction({ agentId: "a", sessionId: "s1", tool: "t1" }), allow);
    await store.record(
      makeAction({ agentId: "b", sessionId: "s1", tool: "t2" }),
      { action: "deny", reason: "x" },
    );
    expect((await store.list({ agentId: "a" })).length).toBe(1);
    expect((await store.list({ sessionId: "s1" })).length).toBe(2);
    expect((await store.list({ tool: "t2" })).length).toBe(1);
    expect((await store.list({ decision: "deny" })).length).toBe(1);
  });

  it("chains by parentActionId", async () => {
    const store = new MemoryTraceStore(new CapturingLogger());
    const parent = makeAction({ agentId: "a", tool: "t1" });
    await store.record(parent, allow);
    await store.record(
      makeAction({ agentId: "a", tool: "t2", parentActionId: parent.id }),
      allow,
    );
    const chain = await store.chain(parent.id);
    expect(chain.length).toBe(1);
    expect(chain[0].action.parentActionId).toBe(parent.id);
  });

  it("filters by timestamp window", async () => {
    const store = new MemoryTraceStore(new CapturingLogger());
    await store.record(
      makeAction({ agentId: "a", tool: "t1", timestamp: "2026-01-01T00:00:00Z" }),
      allow,
    );
    await store.record(
      makeAction({ agentId: "a", tool: "t2", timestamp: "2026-06-01T00:00:00Z" }),
      allow,
    );
    expect((await store.list({ since: "2026-03-01T00:00:00Z" })).length).toBe(1);
    expect((await store.list({ until: "2026-03-01T00:00:00Z" })).length).toBe(1);
  });
});

describe("makeAction defaults", () => {
  it("fills id, sessionId, params, prompt, model, timestamp", () => {
    const a = makeAction({ agentId: "a", tool: "x" });
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.sessionId).toBe("session-test");
    expect(a.params).toEqual({});
    expect(a.prompt).toBe("");
    expect(a.model).toBe("test-model");
    expect(a.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
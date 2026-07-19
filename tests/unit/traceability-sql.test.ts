import { describe, it, expect } from "vitest";
import { SqlTraceStore, type SqlTraceStoreDriver } from "../../src/core/traceability/store.js";
import { makeAction } from "../../src/core/traceability/store.js";
import type { GovernanceDecision } from "../../src/types/index.js";
import { CapturingLogger } from "../../src/core/logger.js";

interface Row {
  id: string;
  agent_id: string;
  session_id: string;
  tool: string;
  params: string;
  prompt: string;
  model: string;
  timestamp: string;
  parent_action_id: string | null;
  decision: string;
  decision_reason: string;
  policy_id: string | null;
  provenance: string;
  recorded_at: string;
}

/**
 * Minimal in-memory SQL driver. Speaks the subset of SQL the SqlTraceStore
 * issues (CREATE TABLE, CREATE INDEX, INSERT, SELECT) well enough for tests.
 */
class FakeSqlDriver implements SqlTraceStoreDriver {
  rows = new Map<string, Row>();
  execCalls: { sql: string; params?: unknown[] }[] = [];

  async exec(sql: string, params?: unknown[]): Promise<void> {
    this.execCalls.push({ sql, params });
    const upper = sql.trim().toUpperCase();
    if (upper.startsWith("INSERT")) {
      const [id, agent_id, session_id, tool, params_json, prompt, model, timestamp, parent_action_id, decision, decision_reason, policy_id, provenance, recorded_at] = params ?? [];
      this.rows.set(id as string, {
        id: id as string,
        agent_id: agent_id as string,
        session_id: session_id as string,
        tool: tool as string,
        params: params_json as string,
        prompt: prompt as string,
        model: model as string,
        timestamp: timestamp as string,
        parent_action_id: (parent_action_id as string | null) ?? null,
        decision: decision as string,
        decision_reason: decision_reason as string,
        policy_id: (policy_id as string | null) ?? null,
        provenance: provenance as string,
        recorded_at: recorded_at as string,
      });
    }
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const lower = sql.toLowerCase();
    const upper = lower.trim();
    if (!upper.startsWith("select")) return [] as T[];
    const all = [...this.rows.values()];
    if (lower.includes("where id =")) {
      const id = params?.[0] as string;
      const row = this.rows.get(id);
      return (row ? [row] : []) as unknown as T[];
    }
    if (lower.includes("where parent_action_id =")) {
      const parent = params?.[0] as string;
      return all.filter((r) => r.parent_action_id === parent) as unknown as T[];
    }
    if (params && params.length > 0 && lower.includes("where")) {
      const clauses: { column: keyof Row; op: "=" | ">=" | "<" }[] = [];
      if (lower.includes("agent_id =")) clauses.push({ column: "agent_id", op: "=" });
      if (lower.includes("session_id =")) clauses.push({ column: "session_id", op: "=" });
      if (lower.includes("tool =")) clauses.push({ column: "tool", op: "=" });
      if (lower.includes("decision =")) clauses.push({ column: "decision", op: "=" });
      if (lower.includes("timestamp >=")) clauses.push({ column: "timestamp", op: ">=" });
      if (lower.includes("timestamp <")) clauses.push({ column: "timestamp", op: "<" });
      return all.filter((r) =>
        clauses.every((c, i) => compare(String(r[c.column]), params[i] as string, c.op)),
      ) as unknown as T[];
    }
    return all as unknown as T[];
  }
}

const allow: GovernanceDecision = { action: "allow", reason: "ok" };

describe("SqlTraceStore", () => {
  it("creates the schema on ensureSchema()", async () => {
    const driver = new FakeSqlDriver();
    const store = new SqlTraceStore(driver, new CapturingLogger());
    await store.ensureSchema();
    expect(driver.execCalls.length).toBeGreaterThan(0);
    expect(driver.execCalls[0].sql).toMatch(/CREATE TABLE/);
  });

  it("records and retrieves an action by id", async () => {
    const driver = new FakeSqlDriver();
    const store = new SqlTraceStore(driver, new CapturingLogger());
    await store.ensureSchema();
    const action = makeAction({ agentId: "a", tool: "write_file", params: { path: "x.ts" } });
    const record = await store.record(action, allow);
    expect(record.decision.action).toBe("allow");
    expect(record.provenance["@context"]).toBe("https://www.w3.org/ns/prov");
    const got = await store.get(action.id);
    expect(got?.action.id).toBe(action.id);
    expect(got?.action.params).toEqual({ path: "x.ts" });
  });

  it("returns null for unknown ids", async () => {
    const store = new SqlTraceStore(new FakeSqlDriver(), new CapturingLogger());
    expect(await store.get("missing")).toBeNull();
  });

  it("chains child actions by parentActionId", async () => {
    const driver = new FakeSqlDriver();
    const store = new SqlTraceStore(driver, new CapturingLogger());
    await store.ensureSchema();
    const parent = makeAction({ agentId: "a", tool: "t1" });
    await store.record(parent, allow);
    await store.record(makeAction({ agentId: "a", tool: "t2", parentActionId: parent.id }), allow);
    const chain = await store.chain(parent.id);
    expect(chain.length).toBe(1);
    expect(chain[0].action.parentActionId).toBe(parent.id);
  });

  it("list() returns all rows when no filter is given", async () => {
    const driver = new FakeSqlDriver();
    const store = new SqlTraceStore(driver, new CapturingLogger());
    await store.ensureSchema();
    await store.record(makeAction({ agentId: "a", tool: "t1" }), allow);
    await store.record(makeAction({ agentId: "b", tool: "t2" }), allow);
    const list = await store.list();
    expect(list.length).toBe(2);
  });

  it("list() filters by agentId and decision", async () => {
    const driver = new FakeSqlDriver();
    const store = new SqlTraceStore(driver, new CapturingLogger());
    await store.ensureSchema();
    await store.record(makeAction({ agentId: "a", tool: "t1" }), allow);
    await store.record(makeAction({ agentId: "b", tool: "t2" }), { action: "deny", reason: "x" });
    expect((await store.list({ agentId: "a" })).length).toBe(1);
    expect((await store.list({ decision: "deny" })).length).toBe(1);
  });
});

function compare(a: string, b: string, op: "=" | ">=" | "<"): boolean {
  if (op === "=") return a === b;
  if (op === ">=") return a >= b;
  return a < b;
}
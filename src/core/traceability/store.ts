/**
 * Traceability layer – records every agent action, decision and provenance.
 *
 * The store has two implementations:
 *   - `MemoryTraceStore`: in-process, used by tests and local dev.
 *   - `SqlTraceStore`: PostgreSQL/SQLite-backed for production.
 *
 * Both expose the same `TraceStore` interface so callers do not care which one
 * runs.
 */
import { v4 as uuidv4 } from "uuid";
import type {
  AgentAction,
  AuditRecord,
  GovernanceDecision,
  Provenance,
} from "../../types/index.js";
import type { Logger } from "../logger.js";

export interface TraceStore {
  record(action: AgentAction, decision: GovernanceDecision): Promise<AuditRecord>;
  get(id: string): Promise<AuditRecord | null>;
  list(filter?: TraceFilter): Promise<AuditRecord[]>;
  chain(parentActionId: string): Promise<AuditRecord[]>;
  close(): Promise<void>;
}

export interface TraceFilter {
  agentId?: string;
  sessionId?: string;
  tool?: string;
  /** ISO date lower bound (inclusive). */
  since?: string;
  /** ISO date upper bound (exclusive). */
  until?: string;
  decision?: string;
}

/** Build a W3C PROV-O compatible provenance object for an action/decision. */
export function buildProvenance(action: AgentAction): Provenance {
  return {
    "@context": "https://www.w3.org/ns/prov",
    entity: {
      id: action.id,
      type: "AgentAction",
      wasGeneratedBy: action.agentId,
      used: action.prompt ? `${action.sessionId}/prompt` : action.sessionId,
    },
    activity: {
      id: `${action.id}/activity`,
      type: action.tool === "review" ? "Review" : "ToolInvocation",
      startedAtTime: action.timestamp,
      endedAtTime: new Date().toISOString(),
      wasAssociatedWith: action.agentId,
    },
    agent: {
      id: action.agentId,
      type: "SoftwareAgent",
      label: `${action.agentId} (${action.model})`,
    },
  };
}

/** In-memory trace store, used by tests and ephemeral runs. */
export class MemoryTraceStore implements TraceStore {
  private records = new Map<string, AuditRecord>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async record(action: AgentAction, decision: GovernanceDecision): Promise<AuditRecord> {
    const record: AuditRecord = {
      action,
      decision,
      provenance: buildProvenance(action),
      recordedAt: new Date().toISOString(),
    };
    this.records.set(action.id, record);
    this.logger.debug("Trace recorded", { id: action.id, tool: action.tool });
    return record;
  }

  async get(id: string): Promise<AuditRecord | null> {
    return this.records.get(id) ?? null;
  }

  async list(filter?: TraceFilter): Promise<AuditRecord[]> {
    const all = [...this.records.values()];
    return all.filter((r) => matchesFilter(r, filter));
  }

  async chain(parentActionId: string): Promise<AuditRecord[]> {
    return [...this.records.values()].filter(
      (r) => r.action.parentActionId === parentActionId,
    );
  }

  async close(): Promise<void> {
    this.records.clear();
  }
}

function matchesFilter(record: AuditRecord, filter?: TraceFilter): boolean {
  if (!filter) return true;
  if (filter.agentId && record.action.agentId !== filter.agentId) return false;
  if (filter.sessionId && record.action.sessionId !== filter.sessionId) return false;
  if (filter.tool && record.action.tool !== filter.tool) return false;
  if (filter.decision && record.decision.action !== filter.decision) return false;
  if (filter.since && record.action.timestamp < filter.since) return false;
  if (filter.until && record.action.timestamp >= filter.until) return false;
  return true;
}

/**
 * SQL-backed trace store. Uses parameterised queries to be safe with both
 * PostgreSQL and SQLite-compatible drivers. The schema is created lazily.
 *
 * NOTE: The actual driver is injected so we can test this class against a
 * fake driver without a real database. See `SqlTraceStoreDriver`.
 */
export interface SqlTraceStoreDriver {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export class SqlTraceStore implements TraceStore {
  constructor(
    private readonly driver: SqlTraceStoreDriver,
    private readonly logger: Logger,
  ) {}

  async ensureSchema(): Promise<void> {
    await this.driver.exec(SCHEMA_SQL);
  }

  async record(action: AgentAction, decision: GovernanceDecision): Promise<AuditRecord> {
    const provenance = buildProvenance(action);
    const record: AuditRecord = {
      action,
      decision,
      provenance,
      recordedAt: new Date().toISOString(),
    };
    await this.driver.exec(INSERT_SQL, [
      action.id,
      action.agentId,
      action.sessionId,
      action.tool,
      JSON.stringify(action.params),
      action.prompt,
      action.model,
      action.timestamp,
      action.parentActionId ?? null,
      decision.action,
      decision.reason,
      decision.policyId ?? null,
      JSON.stringify(provenance),
      record.recordedAt,
    ]);
    this.logger.debug("Trace recorded (sql)", { id: action.id });
    return record;
  }

  async get(id: string): Promise<AuditRecord | null> {
    const rows = await this.driver.query<TraceRow>(SELECT_BY_ID_SQL, [id]);
    return rows.length ? rowToRecord(rows[0]) : null;
  }

  async list(filter?: TraceFilter): Promise<AuditRecord[]> {
    if (!filter) {
      const rows = await this.driver.query<TraceRow>(SELECT_ALL_SQL);
      return rows.map(rowToRecord);
    }
    const { sql, params } = buildFilterQuery(filter);
    const rows = await this.driver.query<TraceRow>(sql, params);
    return rows.map(rowToRecord);
  }

  async chain(parentActionId: string): Promise<AuditRecord[]> {
    const rows = await this.driver.query<TraceRow>(SELECT_BY_PARENT_SQL, [
      parentActionId,
    ]);
    return rows.map(rowToRecord);
  }

  async close(): Promise<void> {
    /* connection lifecycle owned by the driver; nothing to close here. */
  }
}

interface TraceRow {
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

function rowToRecord(row: TraceRow): AuditRecord {
  return {
    action: {
      id: row.id,
      agentId: row.agent_id,
      sessionId: row.session_id,
      tool: row.tool,
      params: JSON.parse(row.params) as Record<string, unknown>,
      prompt: row.prompt,
      model: row.model,
      timestamp: row.timestamp,
      parentActionId: row.parent_action_id ?? undefined,
    },
    decision: {
      action: row.decision as GovernanceDecision["action"],
      reason: row.decision_reason,
      policyId: row.policy_id ?? undefined,
    },
    provenance: JSON.parse(row.provenance) as Provenance,
    recordedAt: row.recorded_at,
  };
}

const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  params TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  parent_action_id TEXT,
  decision TEXT NOT NULL,
  decision_reason TEXT NOT NULL,
  policy_id TEXT,
  provenance TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_actions_agent_session ON agent_actions(agent_id, session_id);
CREATE INDEX IF NOT EXISTS idx_agent_actions_timestamp ON agent_actions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agent_actions_parent ON agent_actions(parent_action_id);`;

const INSERT_SQL = `INSERT INTO agent_actions
  (id, agent_id, session_id, tool, params, prompt, model, timestamp, parent_action_id, decision, decision_reason, policy_id, provenance, recorded_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`;

const SELECT_BY_ID_SQL = `SELECT * FROM agent_actions WHERE id = $1`;
const SELECT_ALL_SQL = `SELECT * FROM agent_actions ORDER BY timestamp DESC LIMIT 1000`;
const SELECT_BY_PARENT_SQL = `SELECT * FROM agent_actions WHERE parent_action_id = $1 ORDER BY timestamp ASC`;

function buildFilterQuery(filter: TraceFilter): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.agentId) {
    params.push(filter.agentId);
    where.push(`agent_id = $${params.length}`);
  }
  if (filter.sessionId) {
    params.push(filter.sessionId);
    where.push(`session_id = $${params.length}`);
  }
  if (filter.tool) {
    params.push(filter.tool);
    where.push(`tool = $${params.length}`);
  }
  if (filter.decision) {
    params.push(filter.decision);
    where.push(`decision = $${params.length}`);
  }
  if (filter.since) {
    params.push(filter.since);
    where.push(`timestamp >= $${params.length}`);
  }
  if (filter.until) {
    params.push(filter.until);
    where.push(`timestamp < $${params.length}`);
  }
  const sql = `SELECT * FROM agent_actions${
    where.length ? ` WHERE ${where.join(" AND ")}` : ""
  } ORDER BY timestamp DESC LIMIT 1000`;
  return { sql, params };
}

/** Create an action with sensible defaults, mainly used by tests/tooling. */
export function makeAction(partial: Partial<AgentAction> & { agentId: string; tool: string }): AgentAction {
  return {
    id: partial.id ?? uuidv4(),
    sessionId: partial.sessionId ?? "session-test",
    params: partial.params ?? {},
    prompt: partial.prompt ?? "",
    model: partial.model ?? "test-model",
    timestamp: partial.timestamp ?? new Date().toISOString(),
    ...partial,
  };
}
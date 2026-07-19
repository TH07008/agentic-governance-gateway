/**
 * Core type definitions for the Agentic Governance Gateway.
 *
 * These types are intentionally stable and self-describing so that policies,
 * audit logs, and MCP tool calls can all share the same vocabulary.
 */

/** A tool call issued by a coding agent, before governance evaluation. */
export interface AgentAction {
  /** Unique id for this action (UUID v4). */
  id: string;
  /** Stable identifier of the agent (e.g. "claude-code", "cursor", "ollama-lydia"). */
  agentId: string;
  /** Session identifier that groups a conversation/run together. */
  sessionId: string;
  /** Tool name the agent wants to invoke (e.g. "write_file", "git_push"). */
  tool: string;
  /** Tool parameters as provided by the agent. */
  params: Record<string, unknown>;
  /** The original user prompt that led to this action, if available. */
  prompt: string;
  /** Model identifier (e.g. "claude-3-opus", "llama3:70b"). */
  model: string;
  /** ISO-8601 timestamp the action was observed. */
  timestamp: string;
  /** Optional counter for how many iterations the agent has attempted for this task. */
  iteration?: number;
  /** Optional parent action id, for chained actions. */
  parentActionId?: string;
}

/** The decision returned by the governance engine for an action. */
export interface GovernanceDecision {
  /** What the gateway decided to do with the action. */
  action: DecisionKind;
  /** Human-readable reason, suitable for showing back to the agent. */
  reason: string;
  /** Id of the policy that triggered the decision, if any. */
  policyId?: string;
  /** When `action === "require_review"`, review instructions. */
  requireReview?: ReviewRequest;
  /** Estimated cost of the action in USD, if computed. */
  estimatedCostUsd?: number;
}

export type DecisionKind = "allow" | "deny" | "require_review";

export interface ReviewRequest {
  /** Usernames or team names that should review. */
  reviewers: string[];
  /** Timeout in seconds before the request auto-deny. */
  timeoutSeconds: number;
  /** Optional human-readable summary shown to the reviewer. */
  summary: string;
}

/** Result of recording an action in the traceability store. */
export interface AuditRecord {
  action: AgentAction;
  decision: GovernanceDecision;
  /** W3C PROV-O compliant provenance object. */
  provenance: Provenance;
  /** ISO-8601 timestamp the record was persisted. */
  recordedAt: string;
}

/** W3C PROV-O compatible provenance block. */
export interface Provenance {
  "@context": "https://www.w3.org/ns/prov";
  entity: {
    id: string;
    type: "AgentAction";
    wasGeneratedBy: string;
    used: string;
  };
  activity: {
    id: string;
    type: "CodeGeneration" | "ToolInvocation" | "Review";
    startedAtTime: string;
    endedAtTime: string;
    wasAssociatedWith: string;
  };
  agent: {
    id: string;
    type: "SoftwareAgent";
    label: string;
  };
}

/** A policy rule definition, used by the in-process fallback evaluator. */
export interface PolicyRule {
  /** Unique id of the rule (e.g. "no-prod-data-in-prompt"). */
  id: string;
  /** Human-readable description, shown in decisions. */
  description: string;
  /** Severity: deny blocks, review escalates. */
  severity: "deny" | "review";
  /** Predicate that returns true if the rule fires for the given action. */
  matches: (action: AgentAction, ctx: PolicyContext) => boolean;
}

/** Context passed to policy evaluators (iteration counts, budgets, etc.). */
export interface PolicyContext {
  /** Current iteration count for the session/task. */
  iterationCount: number;
  /** Accumulated daily cost in USD for the agent. */
  dailyCostUsd: number;
  /** Accumulated monthly cost in USD for the agent. */
  monthlyCostUsd: number;
  /** List of file paths affected by the action, if known. */
  affectedPaths: string[];
}

/** Result of a validation check (security scan, test run, etc.). */
export interface ValidationResult {
  /** Checker name (e.g. "semgrep", "npm-test", "checkov"). */
  checker: string;
  /** Whether the check passed. */
  passed: boolean;
  /** Human-readable summary of findings. */
  summary: string;
  /** Optional list of findings, for audit. */
  findings?: ValidationFinding[];
  /** Duration in milliseconds. */
  durationMs: number;
}

export interface ValidationFinding {
  severity: "info" | "warning" | "error";
  message: string;
  location?: string;
}

/** Human-in-the-loop review record. */
export interface ReviewRecord {
  id: string;
  action: AgentAction;
  decision: GovernanceDecision;
  status: "pending" | "approved" | "denied" | "expired";
  reviewers: string[];
  /** Hash of the action at request time, used to verify it does not drift. */
  actionHash: string;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

/** Budget snapshot for an agent. */
export interface BudgetSnapshot {
  agentId: string;
  dailyCostUsd: number;
  monthlyCostUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  /** Remaining daily budget in USD. */
  remainingDailyUsd: number;
  /** Remaining monthly budget in USD. */
  remainingMonthlyUsd: number;
}

/** Gateway configuration loaded from env / config file. */
export interface GatewayConfig {
  policyDir: string;
  fallbackToJsEvaluator: boolean;
  databaseUrl: string;
  defaultDailyBudgetUsd: number;
  defaultMonthlyBudgetUsd: number;
  hitlTimeoutSeconds: number;
  mcpServerName: string;
  mcpServerVersion: string;
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
}
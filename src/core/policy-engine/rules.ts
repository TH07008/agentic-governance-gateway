/**
 * Built-in policy rules used by the in-process fallback evaluator when no OPA
 * WASM bundle is available (e.g. in CI or local dev without OPA installed).
 *
 * The rules mirror the Rego policies in `policies/*.rego` so that both
 * evaluators produce equivalent decisions for the same inputs.
 */
import type { PolicyRule, AgentAction } from "../../types/index.js";

const text = (action: AgentAction): string =>
  [action.prompt, JSON.stringify(action.params ?? {})].join("\n");

const hasPattern = (input: string, pattern: RegExp): boolean => pattern.test(input);

/** Matches US Social Security Numbers like 123-45-6789. */
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;

/** Matches common AWS access key prefixes. */
const AWS_KEY_PATTERN = /AKIA[0-9A-Z]{16}/;

/** Matches generic API key-looking assignments, including JSON-escaped quotes. */
const KEY_ASSIGN_PATTERN =
  /(api[_-]?key|secret|token|password)\s*[:=]\s*\\?['"][A-Za-z0-9_\-]{16,}\\?['"]/i;

/** Paths considered production-adjacent and therefore sensitive. */
const PROD_PATH_PATTERN =
  /(\/prod\/|\/production\/|infra\/terraform\/|k8s\/prod|secrets\/)/i;

/** Files whose changes can break API contracts and warrant review. */
const API_CONTRACT_FILES = ["openapi.yaml", "openapi.json", "swagger.json"];

export const builtInRules: PolicyRule[] = [
  {
    id: "no-prod-data-in-prompt",
    description: "Prompt contains what looks like a US Social Security Number",
    severity: "deny",
    matches: (action) => hasPattern(text(action), SSN_PATTERN),
  },
  {
    id: "no-aws-keys-in-prompt",
    description: "Prompt or params contain an AWS access key id",
    severity: "deny",
    matches: (action) => hasPattern(text(action), AWS_KEY_PATTERN),
  },
  {
    id: "no-hardcoded-secrets",
    description: "Action params contain a hardcoded secret assignment",
    severity: "deny",
    matches: (action) => hasPattern(text(action), KEY_ASSIGN_PATTERN),
  },
  {
    id: "max-iterations",
    description: "Task exceeded the maximum number of agent iterations (5)",
    severity: "deny",
    matches: (_action, ctx) => ctx.iterationCount > 5,
  },
  {
    id: "api-contract-change-requires-review",
    description: "Changes to API contract files require human review",
    severity: "review",
    matches: (action, ctx) =>
      action.tool === "git_push" &&
      ctx.affectedPaths.some((p) => API_CONTRACT_FILES.some((f) => p.endsWith(f))),
  },
  {
    id: "prod-path-change-requires-review",
    description: "Changes touching production paths require human review",
    severity: "review",
    matches: (action, ctx) =>
      action.tool === "git_push" &&
      ctx.affectedPaths.some((p) => PROD_PATH_PATTERN.test(p)),
  },
  {
    id: "daily-budget-cap",
    description: "Daily token budget exceeded for this agent",
    severity: "deny",
    matches: (_action, ctx) => ctx.dailyCostUsd >= 50,
  },
  {
    id: "monthly-budget-cap",
    description: "Monthly token budget exceeded for this agent",
    severity: "deny",
    matches: (_action, ctx) => ctx.monthlyCostUsd >= 1000,
  },
  {
    id: "no-direct-db-drop",
    description: "Direct DROP TABLE statements are not allowed",
    severity: "deny",
    matches: (action) =>
      action.tool === "execute_sql" &&
      /\bdrop\s+table\b/i.test(String(action.params?.sql ?? "")),
  },
  {
    id: "no-rmrf",
    description: "Recursive force-delete commands are not allowed",
    severity: "deny",
    matches: (action) =>
      action.tool === "bash" && /\brm\s+-rf\s+\/(?:\s|$)/i.test(String(action.params?.command ?? "")),
  },
];

/** Compute the affected paths from an action, used as context input. */
export function affectedPathsFrom(action: AgentAction): string[] {
  const paths: string[] = [];
  const p = action.params ?? {};
  if (typeof p.path === "string") paths.push(p.path);
  if (typeof p.file === "string") paths.push(p.file);
  if (Array.isArray(p.paths)) paths.push(...p.paths.filter((x): x is string => typeof x === "string"));
  if (Array.isArray(p.files)) paths.push(...p.files.filter((x): x is string => typeof x === "string"));
  if (Array.isArray(p.changes)) {
    for (const c of p.changes) {
      if (c && typeof c === "object" && typeof (c as { path?: unknown }).path === "string") {
        paths.push((c as { path: string }).path);
      }
    }
  }
  return paths;
}
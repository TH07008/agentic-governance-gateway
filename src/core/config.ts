/**
 * Loads gateway configuration from environment variables with sensible defaults.
 * Keeps all other modules free of direct `process.env` access.
 */
import type { GatewayConfig } from "../types/index.js";

const num = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1" || value === "yes";
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const logLevel = (env.LOG_LEVEL as GatewayConfig["logLevel"]) ?? "info";
  const validLevels: GatewayConfig["logLevel"][] = [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
  ];
  return {
    policyDir: env.OPA_POLICY_DIR ?? "./policies",
    fallbackToJsEvaluator: bool(env.POLICY_FALLBACK_JS, true),
    databaseUrl: env.DATABASE_URL ?? "sqlite://./data/governance.db",
    defaultDailyBudgetUsd: num(env.DEFAULT_DAILY_BUDGET_USD, 50),
    defaultMonthlyBudgetUsd: num(env.DEFAULT_MONTHLY_BUDGET_USD, 1000),
    hitlTimeoutSeconds: num(env.HITL_TIMEOUT_SECONDS, 300),
    mcpServerName: env.MCP_SERVER_NAME ?? "agentic-governance-gateway",
    mcpServerVersion: env.MCP_SERVER_VERSION ?? "0.1.0",
    logLevel: validLevels.includes(logLevel) ? logLevel : "info",
  };
}
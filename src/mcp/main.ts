#!/usr/bin/env node
/**
 * MCP server entrypoint. Run with `node dist/mcp/server.js` or via the
 * `agentic-gateway-mcp` bin. Designed to be referenced from an MCP client's
 * configuration (Claude Code, Cursor, etc.) so the agent talks to the gateway
 * instead of calling tools directly.
 *
 * Example `~/.cursor/mcp.json` snippet:
 *   {
 *     "mcpServers": {
 *       "agentic-governance-gateway": {
 *         "command": "npx",
 *         "args": ["-y", "agentic-governance-gateway", "mcp"]
 *       }
 *     }
 *   }
 */
import { loadConfig } from "../core/config.js";
import { createLogger } from "../core/logger.js";
import { PolicyEngine } from "../core/policy-engine/engine.js";
import { MemoryTraceStore } from "../core/traceability/store.js";
import {
  BudgetController,
  MemoryBudgetStore,
} from "../core/budget/controller.js";
import { Gateway } from "../core/gateway.js";
import { startStdioServer } from "../mcp/server.js";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logger = createLogger(cfg.logLevel);
  const policyEngine = await PolicyEngine.create({
    policyDir: resolve(cfg.policyDir),
    opaBundlePath: cfg.fallbackToJsEvaluator ? undefined : undefined, // OPA bundle optional
    fallbackToJsEvaluator: cfg.fallbackToJsEvaluator,
    logger,
  });
  const traceStore = new MemoryTraceStore(logger);
  const budgetStore = new MemoryBudgetStore(
    cfg.defaultDailyBudgetUsd,
    cfg.defaultMonthlyBudgetUsd,
  );
  const budgetController = new BudgetController({
    store: budgetStore,
    defaultDailyLimitUsd: cfg.defaultDailyBudgetUsd,
    defaultMonthlyLimitUsd: cfg.defaultMonthlyBudgetUsd,
    logger,
  });
  // Default executor: the MCP server does not execute tools itself; it returns
  // the decision so the host agent can decide. A production deployment would
  // inject a real executor (shell wrapper, git wrapper, etc.).
  const gateway = new Gateway({
    policyEngine,
    traceStore,
    budgetController,
    executor: async (tool, _params) => `would-execute:${tool}`,
    logger,
  });
  await startStdioServer({
    gateway,
    budgetController,
    traceStore,
    logger,
    name: cfg.mcpServerName,
    version: cfg.mcpServerVersion,
  });
}

main().catch((err) => {
  console.error("agentic-governance-gateway: fatal", err);
  process.exit(1);
});
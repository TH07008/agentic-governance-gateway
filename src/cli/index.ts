#!/usr/bin/env node
/**
 * Standalone CLI for ad-hoc policy checks. Lets you verify a hypothetical agent
 * action against the policy engine without spinning up an MCP server or
 * connecting a real agent. Useful for demos and CI.
 *
 * Examples:
 *   agentic-gateway evaluate --tool write_file --agent-id claude-code \
 *     --params '{"path":"prod/secrets.yml"}' --prompt 'update password'
 *   agentic-gateway policies        # list built-in rules
 *   agentic-gateway status          # report which evaluator is in use
 */
import { parseArgs } from "node:util";
import { loadConfig } from "../core/config.js";
import { createLogger } from "../core/logger.js";
import { PolicyEngine } from "../core/policy-engine/engine.js";
import { builtInRules } from "../core/policy-engine/rules.js";
import { makeAction } from "../core/traceability/store.js";
import { MemoryBudgetStore } from "../core/budget/controller.js";
import { buildContext } from "../core/policy-engine/evaluator.js";

async function main(): Promise<void> {
  const { positionals } = parseArgs({
    allowPositionals: true,
    args: process.argv.slice(2),
    options: {
      tool: { type: "string", short: "t", default: "write_file" },
      "agent-id": { type: "string", short: "a", default: "cli" },
      session: { type: "string", short: "s", default: "cli-session" },
      params: { type: "string", short: "p", default: "{}" },
      prompt: { type: "string", short: "P", default: "" },
      model: { type: "string", short: "m", default: "test-model" },
      iteration: { type: "string", short: "i", default: "0" },
      "daily-cost": { type: "string", default: "0" },
      "monthly-cost": { type: "string", default: "0" },
    },
  });

  const command = positionals[0] ?? "help";
  const cfg = loadConfig();
  const logger = createLogger("warn");

  if (command === "help" || command === "--help") {
    console.log(HELP_TEXT);
    return;
  }

  if (command === "policies") {
    for (const rule of builtInRules) {
      console.log(`${rule.severity.toUpperCase().padEnd(6)} ${rule.id}  ${rule.description}`);
    }
    return;
  }

  if (command === "status") {
    const engine = await PolicyEngine.create({
      policyDir: cfg.policyDir,
      fallbackToJsEvaluator: cfg.fallbackToJsEvaluator,
      logger,
    });
    console.log(JSON.stringify({ evaluator: engine.evaluatorName, config: cfg }, null, 2));
    return;
  }

  if (command === "evaluate") {
    const opts = parseArgs({
      allowPositionals: false,
      args: process.argv.slice(3),
      options: {
        tool: { type: "string", short: "t", default: "write_file" },
        "agent-id": { type: "string", short: "a", default: "cli" },
        session: { type: "string", short: "s", default: "cli-session" },
        params: { type: "string", short: "p", default: "{}" },
        prompt: { type: "string", short: "P", default: "" },
        model: { type: "string", short: "m", default: "test-model" },
        iteration: { type: "string", short: "i", default: "0" },
        "daily-cost": { type: "string", default: "0" },
        "monthly-cost": { type: "string", default: "0" },
      },
    }).values;
    const params = JSON.parse((opts.params as string) || "{}") as Record<string, unknown>;
    const action = makeAction({
      agentId: opts["agent-id"] as string,
      sessionId: opts.session as string,
      tool: opts.tool as string,
      params,
      prompt: opts.prompt as string,
      model: opts.model as string,
      iteration: Number(opts.iteration ?? 0),
    });
    const budgetStore = new MemoryBudgetStore(cfg.defaultDailyBudgetUsd, cfg.defaultMonthlyBudgetUsd);
    budgetStore._setDailyForTest(action.agentId, Number(opts["daily-cost"] ?? 0));
    budgetStore._setMonthlyForTest(action.agentId, Number(opts["monthly-cost"] ?? 0));
    const engine = await PolicyEngine.create({
      policyDir: cfg.policyDir,
      fallbackToJsEvaluator: cfg.fallbackToJsEvaluator,
      logger,
    });
    const snapshot = await budgetStore.getSnapshot(action.agentId);
    const ctx = buildContext(action, { dailyCostUsd: snapshot.dailyCostUsd, monthlyCostUsd: snapshot.monthlyCostUsd }, Number(opts.iteration ?? 0));
    const decision = await engine.evaluate(action, { dailyCostUsd: snapshot.dailyCostUsd, monthlyCostUsd: snapshot.monthlyCostUsd }, Number(opts.iteration ?? 0));
    console.log(
      JSON.stringify(
        {
          action: { id: action.id, tool: action.tool, affectedPaths: ctx.affectedPaths },
          decision,
          evaluator: engine.evaluatorName,
        },
        null,
        2,
      ),
    );
    process.exit(decision.action === "deny" ? 2 : 0);
  }

  console.error(`Unknown command: ${command}\n\n${HELP_TEXT}`);
  process.exit(64);
}

const HELP_TEXT = `agentic-governance-gateway CLI

Commands:
  evaluate   Evaluate a hypothetical agent action against the policies.
  policies   List the built-in policy rules.
  status     Show the active evaluator and configuration.
  help       Show this help.

Evaluate options:
  -t, --tool        Tool name                (default: write_file)
  -a, --agent-id    Agent identifier         (default: cli)
  -s, --session     Session id               (default: cli-session)
  -p, --params      JSON params for the tool (default: {})
  -P, --prompt      Original user prompt     (default: "")
  -m, --model        Model id                 (default: test-model)
  -i, --iteration   Iteration count          (default: 0)
      --daily-cost  Simulated daily spend USD (default: 0)
      --monthly-cost Simulated monthly spend USD (default: 0)

Exit codes:
  0  decision = allow or require_review
  2  decision = deny
  64 invalid usage
`;

main().catch((err) => {
  console.error("agentic-gateway:", err);
  process.exit(1);
});
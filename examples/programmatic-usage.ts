/**
 * Example: building the gateway programmatically and processing an action.
 *
 * Run with: npx tsx examples/programmatic-usage.ts
 */
import {
  PolicyEngine,
  MemoryTraceStore,
  MemoryBudgetStore,
  BudgetController,
  Gateway,
  MemoryReviewProvider,
  HitlGateway,
  createLogger,
} from "../src/index.js";

async function main(): Promise<void> {
  const logger = createLogger("info");
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
  const hitl = new HitlGateway({
    provider: new MemoryReviewProvider(() => "approved"),
    timeoutSeconds: 30,
    logger,
  });
  const gateway = new Gateway({
    policyEngine,
    traceStore,
    budgetController,
    hitl,
    executor: async (tool, params) => console.log("exec:", tool, params),
    logger,
  });

  const result = await gateway.process({
    agentId: "claude-code",
    sessionId: "demo",
    tool: "git_push",
    params: { paths: ["src/openapi.yaml"] },
    prompt: "add a new endpoint",
    model: "test-model",
  });
  console.log("decision:", result.decision);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
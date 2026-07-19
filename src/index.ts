/**
 * Public entry point. Importing `agentic-governance-gateway` from your own
 * project gives you the building blocks to construct a Gateway programmatically.
 */
export * from "./types/index.js";

export { PolicyEngine } from "./core/policy-engine/engine.js";
export { JsPolicyEvaluator, CompositeEvaluator, buildContext } from "./core/policy-engine/evaluator.js";
export type { PolicyEvaluator } from "./core/policy-engine/evaluator.js";
export { builtInRules, affectedPathsFrom } from "./core/policy-engine/rules.js";
export { loadOpaEvaluator, OpaPolicyEvaluator } from "./core/policy-engine/opa-loader.js";

export { MemoryTraceStore, SqlTraceStore, buildProvenance, makeAction } from "./core/traceability/store.js";
export type { TraceStore, TraceFilter, SqlTraceStoreDriver } from "./core/traceability/store.js";

export { ValidationOrchestrator, StaticChecker, ScriptChecker } from "./core/validation/orchestrator.js";
export type { Checker, OrchestratorResult } from "./core/validation/orchestrator.js";

export { HitlGateway, MemoryReviewProvider, HangingReviewProvider } from "./core/hitl/gateway.js";
export type { ReviewProvider } from "./core/hitl/gateway.js";

export { BudgetController, MemoryBudgetStore } from "./core/budget/controller.js";
export type { BudgetStore } from "./core/budget/controller.js";

export { Gateway, buildLocalGateway } from "./core/gateway.js";
export type { ToolExecutor, GatewayDeps, GatewayResult } from "./core/gateway.js";

export { loadConfig } from "./core/config.js";
export { createLogger, PinoLoggerAdapter, CapturingLogger } from "./core/logger.js";
export type { Logger, LogLevel } from "./core/logger.js";
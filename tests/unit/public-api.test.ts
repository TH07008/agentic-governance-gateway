import { describe, it, expect } from "vitest";
import * as gateway from "../../src/index.js";

describe("public API barrel (src/index.ts)", () => {
  it("exports the core building blocks", () => {
    expect(typeof gateway.PolicyEngine).toBe("function");
    expect(typeof gateway.JsPolicyEvaluator).toBe("function");
    expect(typeof gateway.CompositeEvaluator).toBe("function");
    expect(typeof gateway.MemoryTraceStore).toBe("function");
    expect(typeof gateway.SqlTraceStore).toBe("function");
    expect(typeof gateway.buildProvenance).toBe("function");
    expect(typeof gateway.makeAction).toBe("function");
    expect(typeof gateway.ValidationOrchestrator).toBe("function");
    expect(typeof gateway.StaticChecker).toBe("function");
    expect(typeof gateway.ScriptChecker).toBe("function");
    expect(typeof gateway.HitlGateway).toBe("function");
    expect(typeof gateway.MemoryReviewProvider).toBe("function");
    expect(typeof gateway.HangingReviewProvider).toBe("function");
    expect(typeof gateway.BudgetController).toBe("function");
    expect(typeof gateway.MemoryBudgetStore).toBe("function");
    expect(typeof gateway.Gateway).toBe("function");
    expect(typeof gateway.buildLocalGateway).toBe("function");
    expect(typeof gateway.loadConfig).toBe("function");
    expect(typeof gateway.createLogger).toBe("function");
    expect(typeof gateway.PinoLoggerAdapter).toBe("function");
    expect(typeof gateway.CapturingLogger).toBe("function");
  });

  it("exports the built-in rules and helper functions", () => {
    expect(Array.isArray(gateway.builtInRules)).toBe(true);
    expect(gateway.builtInRules.length).toBeGreaterThanOrEqual(8);
    expect(typeof gateway.affectedPathsFrom).toBe("function");
    expect(typeof gateway.buildContext).toBe("function");
    expect(typeof gateway.loadOpaEvaluator).toBe("function");
    expect(typeof gateway.OpaPolicyEvaluator).toBe("function");
  });

  it("re-exports the expected types via the type namespace (compile-time)", () => {
    // Type-only exports are erased at runtime; we just assert the module loaded.
    expect(Object.keys(gateway).length).toBeGreaterThan(15);
  });
});
import { describe, it, expect } from "vitest";
import { BudgetController, MemoryBudgetStore } from "../../src/core/budget/controller.js";
import { makeAction } from "../../src/core/traceability/store.js";
import { CapturingLogger } from "../../src/core/logger.js";

function makeController(daily = 50, monthly = 1000) {
  const store = new MemoryBudgetStore(daily, monthly);
  return {
    store,
    controller: new BudgetController({
      store,
      defaultDailyLimitUsd: daily,
      defaultMonthlyLimitUsd: monthly,
      logger: new CapturingLogger(),
    }),
  };
}

describe("BudgetController.estimateCostUsd", () => {
  it("estimates zero cost for the local test model", () => {
    const { controller } = makeController();
    const action = makeAction({ agentId: "a", tool: "t", prompt: "hello world", model: "test-model" });
    expect(controller.estimateCostUsd(action)).toBe(0);
  });

  it("estimates a positive cost for a priced model with a big prompt", () => {
    const { controller } = makeController();
    const action = makeAction({
      agentId: "a",
      tool: "t",
      prompt: "x".repeat(10_000),
      model: "claude-3-opus",
    });
    expect(controller.estimateCostUsd(action)).toBeGreaterThan(0);
  });
});

describe("BudgetController.check", () => {
  it("allows when the budget has room", async () => {
    const { controller } = makeController();
    const r = await controller.check(makeAction({ agentId: "a", tool: "t", model: "test-model" }));
    expect(r.allowed).toBe(true);
  });

  it("denies when daily budget would be exceeded", async () => {
    const { controller, store } = makeController(10, 1000);
    store._setDailyForTest("a", 9.99);
    const action = makeAction({
      agentId: "a",
      tool: "t",
      prompt: "x".repeat(100_000),
      model: "claude-3-opus",
    });
    const r = await controller.check(action);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("Daily budget");
  });

  it("denies when monthly budget would be exceeded", async () => {
    const { controller, store } = makeController(1000, 1);
    store._setMonthlyForTest("a", 0.99);
    const action = makeAction({
      agentId: "a",
      tool: "t",
      prompt: "x".repeat(100_000),
      model: "claude-3-opus",
    });
    const r = await controller.check(action);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("Monthly budget");
  });
});

describe("BudgetController.charge", () => {
  it("accumulates cost across multiple actions", async () => {
    const { controller, store } = makeController();
    await controller.charge(makeAction({ agentId: "a", tool: "t", model: "test-model" }), 5);
    await controller.charge(makeAction({ agentId: "a", tool: "t", model: "test-model" }), 3);
    const snap = await store.getSnapshot("a");
    expect(snap.dailyCostUsd).toBe(8);
    expect(snap.remainingDailyUsd).toBe(42);
  });

  it("resetDaily clears daily spend but keeps monthly", async () => {
    const { controller, store } = makeController();
    await controller.charge(makeAction({ agentId: "a", tool: "t", model: "test-model" }), 5);
    await store.resetDaily();
    const snap = await store.getSnapshot("a");
    expect(snap.dailyCostUsd).toBe(0);
    expect(snap.monthlyCostUsd).toBe(5);
  });
});
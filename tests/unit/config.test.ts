import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/core/config.js";

describe("loadConfig", () => {
  it("uses defaults when env is empty", () => {
    const cfg = loadConfig({});
    expect(cfg.policyDir).toBe("./policies");
    expect(cfg.fallbackToJsEvaluator).toBe(true);
    expect(cfg.databaseUrl).toBe("sqlite://./data/governance.db");
    expect(cfg.defaultDailyBudgetUsd).toBe(50);
    expect(cfg.defaultMonthlyBudgetUsd).toBe(1000);
    expect(cfg.hitlTimeoutSeconds).toBe(300);
    expect(cfg.mcpServerName).toBe("agentic-governance-gateway");
    expect(cfg.mcpServerVersion).toBe("0.1.0");
    expect(cfg.logLevel).toBe("info");
  });

  it("parses numeric env values", () => {
    const cfg = loadConfig({
      DEFAULT_DAILY_BUDGET_USD: "123",
      DEFAULT_MONTHLY_BUDGET_USD: "4567",
      HITL_TIMEOUT_SECONDS: "99",
    });
    expect(cfg.defaultDailyBudgetUsd).toBe(123);
    expect(cfg.defaultMonthlyBudgetUsd).toBe(4567);
    expect(cfg.hitlTimeoutSeconds).toBe(99);
  });

  it("falls back when numeric env is invalid", () => {
    const cfg = loadConfig({ DEFAULT_DAILY_BUDGET_USD: "not-a-number" });
    expect(cfg.defaultDailyBudgetUsd).toBe(50);
  });

  it("parses boolean env values", () => {
    expect(loadConfig({ POLICY_FALLBACK_JS: "false" }).fallbackToJsEvaluator).toBe(false);
    expect(loadConfig({ POLICY_FALLBACK_JS: "1" }).fallbackToJsEvaluator).toBe(true);
    expect(loadConfig({ POLICY_FALLBACK_JS: "yes" }).fallbackToJsEvaluator).toBe(true);
    expect(loadConfig({ POLICY_FALLBACK_JS: "0" }).fallbackToJsEvaluator).toBe(false);
  });

  it("clamps an invalid log level to info", () => {
    expect(loadConfig({ LOG_LEVEL: "loud" }).logLevel).toBe("info");
    expect(loadConfig({ LOG_LEVEL: "debug" }).logLevel).toBe("debug");
  });

  it("honours explicit policy dir and server identity", () => {
    const cfg = loadConfig({
      OPA_POLICY_DIR: "/etc/policies",
      MCP_SERVER_NAME: "custom",
      MCP_SERVER_VERSION: "9.9.9",
    });
    expect(cfg.policyDir).toBe("/etc/policies");
    expect(cfg.mcpServerName).toBe("custom");
    expect(cfg.mcpServerVersion).toBe("9.9.9");
  });
});
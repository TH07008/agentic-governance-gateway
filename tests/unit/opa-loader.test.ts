import { describe, it, expect } from "vitest";
import { loadOpaEvaluator } from "../../src/core/policy-engine/opa-loader.js";
import { CapturingLogger } from "../../src/core/logger.js";

describe("loadOpaEvaluator (OPA is optional)", () => {
  it("returns null when the bundle path does not exist", async () => {
    const logger = new CapturingLogger();
    const result = await loadOpaEvaluator("/nonexistent/opa-bundle.wasm", logger);
    expect(result).toBeNull();
    // The fallback path should be logged as a warning.
    expect(logger.entries.some((e) => e.level === "warn")).toBe(true);
  });

  it("returns null when the bundle path is empty or unreadable", async () => {
    const logger = new CapturingLogger();
    const result = await loadOpaEvaluator("", logger);
    expect(result).toBeNull();
  });
});
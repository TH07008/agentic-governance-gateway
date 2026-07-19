import { describe, it, expect } from "vitest";
import { PinoLoggerAdapter, CapturingLogger, createLogger } from "../../src/core/logger.js";

describe("CapturingLogger", () => {
  it("captures every level with msg and data", () => {
    const log = new CapturingLogger();
    log.trace("t", { a: 1 });
    log.debug("d");
    log.info("i", { b: 2 });
    log.warn("w");
    log.error("e", { c: 3 });
    expect(log.entries.map((e) => e.level)).toEqual(["trace", "debug", "info", "warn", "error"]);
    expect(log.entries[0]).toMatchObject({ msg: "t", data: { a: 1 } });
    expect(log.entries[2]).toMatchObject({ msg: "i", data: { b: 2 } });
  });

  it("child() returns the same logger (no-op)", () => {
    const log = new CapturingLogger();
    expect(log.child({ x: 1 })).toBe(log);
  });
});

describe("PinoLoggerAdapter", () => {
  it("can be constructed and exposes every level without throwing", () => {
    const log = new PinoLoggerAdapter("warn");
    expect(() => log.trace("t")).not.toThrow();
    expect(() => log.debug("d")).not.toThrow();
    expect(() => log.info("i")).not.toThrow();
    expect(() => log.warn("w", { k: 1 })).not.toThrow();
    expect(() => log.error("e")).not.toThrow();
  });

  it("child() returns a usable logger", () => {
    const log = new PinoLoggerAdapter("info");
    const child = log.child({ scope: "test" });
    expect(() => child.info("hello")).not.toThrow();
  });
});

describe("createLogger factory", () => {
  it("returns a PinoLoggerAdapter", () => {
    const log = createLogger("info");
    expect(log).toBeInstanceOf(PinoLoggerAdapter);
    expect(() => log.info("ok")).not.toThrow();
  });
});
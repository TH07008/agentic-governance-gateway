/**
 * Thin wrapper around pino for structured logging. Kept tiny so tests can
 * swap the logger with a no-op or capturing implementation.
 */
import pino, { type Logger as PinoLogger } from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface Logger {
  trace(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export class PinoLoggerAdapter implements Logger {
  private logger: PinoLogger;

  constructor(level: LogLevel = "info") {
    this.logger = pino({ level });
  }

  /** Internal: wrap an existing pino logger (used by child()). */
  static fromPino(logger: PinoLogger): PinoLoggerAdapter {
    const adapter = Object.create(PinoLoggerAdapter.prototype) as PinoLoggerAdapter;
    adapter.logger = logger;
    return adapter;
  }

  trace(msg: string, data?: Record<string, unknown>): void {
    this.logger.trace(data ?? {}, msg);
  }
  debug(msg: string, data?: Record<string, unknown>): void {
    this.logger.debug(data ?? {}, msg);
  }
  info(msg: string, data?: Record<string, unknown>): void {
    this.logger.info(data ?? {}, msg);
  }
  warn(msg: string, data?: Record<string, unknown>): void {
    this.logger.warn(data ?? {}, msg);
  }
  error(msg: string, data?: Record<string, unknown>): void {
    this.logger.error(data ?? {}, msg);
  }
  child(bindings: Record<string, unknown>): Logger {
    return PinoLoggerAdapter.fromPino(this.logger.child(bindings));
  }
}

/** In-memory logger that captures everything, used by tests. */
export class CapturingLogger implements Logger {
  public entries: { level: string; msg: string; data?: Record<string, unknown> }[] = [];

  trace(msg: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: "trace", msg, data });
  }
  debug(msg: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: "debug", msg, data });
  }
  info(msg: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: "info", msg, data });
  }
  warn(msg: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: "warn", msg, data });
  }
  error(msg: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: "error", msg, data });
  }
  child(): Logger {
    return this;
  }
}

export function createLogger(level: LogLevel = "info"): Logger {
  return new PinoLoggerAdapter(level);
}
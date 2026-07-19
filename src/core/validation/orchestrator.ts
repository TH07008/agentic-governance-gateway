/**
 * Validation orchestrator – runs pluggable checkers (semgrep, npm test,
 * checkov, custom) against an action before it is committed/executed.
 *
 * Each checker implements the `Checker` interface. The orchestrator runs
 * them in parallel and aggregates the results. For tests we ship a
 * `ScriptChecker` that wraps a shell command and a `StaticChecker` that
 * returns a canned result.
 */
import type { AgentAction, ValidationResult, ValidationFinding } from "../../types/index.js";
import type { Logger } from "../logger.js";

export interface Checker {
  readonly name: string;
  /** Return false if this checker should skip the action. */
  appliesTo(action: AgentAction): boolean;
  run(action: AgentAction): Promise<ValidationResult>;
}

export interface ValidationOrchestratorOptions {
  checkers: Checker[];
  logger: Logger;
  /** If true, a failing checker makes the whole run fail. */
  failFast?: boolean;
}

export interface OrchestratorResult {
  passed: boolean;
  results: ValidationResult[];
  durationMs: number;
}

export class ValidationOrchestrator {
  constructor(private readonly opts: ValidationOrchestratorOptions) {}

  async run(action: AgentAction): Promise<OrchestratorResult> {
    const applicable = this.opts.checkers.filter((c) => c.appliesTo(action));
    const started = Date.now();
    const results = await Promise.all(applicable.map((c) => this.runOne(c, action)));
    const passed = this.opts.failFast
      ? results.every((r) => r.passed)
      : results.filter((r) => !r.passed && hasError(r)).length === 0;
    return {
      passed,
      results,
      durationMs: Date.now() - started,
    };
  }

  private async runOne(checker: Checker, action: AgentAction): Promise<ValidationResult> {
    try {
      return await checker.run(action);
    } catch (err) {
      const message = (err as Error).message;
      this.opts.logger.warn("Checker threw", { checker: checker.name, error: message });
      return {
        checker: checker.name,
        passed: false,
        summary: `Checker threw: ${message}`,
        durationMs: 0,
      };
    }
  }
}

function hasError(r: ValidationResult): boolean {
  return r.findings?.some((f) => f.severity === "error") ?? !r.passed;
}

/** A checker that returns a canned result. Used in tests and for demos. */
export class StaticChecker implements Checker {
  readonly name: string;
  private readonly result: ValidationResult;
  private readonly applies: (a: AgentAction) => boolean;

  constructor(
    name: string,
    result: Omit<ValidationResult, "checker">,
    applies: (a: AgentAction) => boolean = () => true,
  ) {
    this.name = name;
    this.result = { ...result, checker: name };
    this.applies = applies;
  }

  appliesTo(action: AgentAction): boolean {
    return this.applies(action);
  }
  async run(): Promise<ValidationResult> {
    return this.result;
  }
}

/**
 * A checker that runs a shell command and decides pass/fail from the exit
 * code. Stdout/stderr are captured as findings. Used to plug real tools
 * (semgrep, npm test, checkov) into the orchestrator.
 */
export class ScriptChecker implements Checker {
  readonly name: string;
  private readonly command: (action: AgentAction) => string | null;
  private readonly applies: (action: AgentAction) => boolean;
  private readonly runner: (cmd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

  constructor(opts: {
    name: string;
    command: (action: AgentAction) => string | null;
    applies?: (action: AgentAction) => boolean;
    /** Inject a custom runner for tests; defaults to child_process.exec. */
    runner?: (cmd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  }) {
    this.name = opts.name;
    this.command = opts.command;
    this.applies = opts.applies ?? (() => true);
    this.runner = opts.runner ?? defaultRunner;
  }

  appliesTo(action: AgentAction): boolean {
    return this.applies(action);
  }

  async run(action: AgentAction): Promise<ValidationResult> {
    const cmd = this.command(action);
    if (cmd === null) {
      return { checker: this.name, passed: true, summary: "No command", durationMs: 0 };
    }
    const started = Date.now();
    try {
      const result = await this.runner(cmd);
      const findings: ValidationFinding[] = [];
      if (result.stdout) findings.push({ severity: "info", message: result.stdout.slice(0, 2000) });
      if (result.stderr) {
        findings.push({ severity: result.exitCode === 0 ? "info" : "error", message: result.stderr.slice(0, 2000) });
      }
      return {
        checker: this.name,
        passed: result.exitCode === 0,
        summary: `exit ${result.exitCode}`,
        findings,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        checker: this.name,
        passed: false,
        summary: `command failed: ${(err as Error).message}`,
        durationMs: Date.now() - started,
      };
    }
  }
}

async function defaultRunner(cmd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { exec } = await import("node:child_process");
  return new Promise((resolve) => {
    exec(cmd, (err, stdout, stderr) => {
      resolve({ exitCode: err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0, stdout, stderr });
    });
  });
}
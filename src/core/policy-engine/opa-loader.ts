/**
 * Loads an OPA WASM bundle and wraps it as a `PolicyEvaluator`.
 *
 * OPA is *optional*. If the bundle cannot be loaded (e.g. opa-wasm not
 * installed, bundle not compiled), `loadOpaEvaluator` returns `null` and the
 * gateway falls back to the JS evaluator. This keeps local dev and CI fully
 * functional without requiring an OPA installation.
 */
import type { PolicyEvaluator } from "./evaluator.js";
import type { AgentAction, GovernanceDecision, PolicyContext } from "../../types/index.js";
import { Logger } from "../logger.js";

interface OpaWasmModule {
  evaluate(input: unknown, options?: unknown): { result?: Record<string, unknown[]> } | Record<string, unknown[]>;
}

export class OpaPolicyEvaluator implements PolicyEvaluator {
  readonly name = "opa-wasm";
  constructor(
    private readonly module: OpaWasmModule,
    private readonly logger: Logger,
  ) {}

  async evaluate(action: AgentAction, ctx: PolicyContext): Promise<GovernanceDecision> {
    const input = { action, context: ctx };
    let raw: unknown;
    try {
      raw = this.module.evaluate(input);
    } catch (err) {
      this.logger.error("OPA evaluate failed", { error: (err as Error).message });
      return {
        action: "require_review",
        reason: `OPA evaluation failed: ${(err as Error).message}`,
      };
    }

    const deny = extractArray(raw, "deny");
    if (deny.length > 0) {
      return { action: "deny", reason: String(deny[0]), policyId: "opa" };
    }
    const review = extractArray(raw, "require_review");
    if (review.length > 0) {
      return {
        action: "require_review",
        reason: String(review[0]),
        policyId: "opa",
        requireReview: {
          reviewers: ["lead-dev"],
          timeoutSeconds: 300,
          summary: String(review[0]),
        },
      };
    }
    return { action: "allow", reason: "OPA: no policies fired" };
  }
}

function extractArray(raw: unknown, key: string): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const value = obj[key] ?? (obj.result as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Try to load an OPA WASM bundle. Returns null if opa-wasm is unavailable
 * or the bundle cannot be read, so callers can fall back to the JS evaluator.
 */
export async function loadOpaEvaluator(
  _bundlePath: string,
  _logger: Logger,
): Promise<OpaPolicyEvaluator | null> {
  try {
    // Dynamic import so the dependency stays optional.
    const mod = (await import("@open-policy-agent/opa-wasm")) as unknown as {
      default?: new (opts: { policy: Buffer }) => OpaWasmModule;
    };
    const fs = await import("node:fs/promises");
    const policy = await fs.readFile(_bundlePath);
    const Opa = mod.default ?? (mod as unknown as new (o: { policy: Buffer }) => OpaWasmModule);
    const instance = new Opa({ policy });
    _logger.info("OPA WASM bundle loaded", { path: _bundlePath });
    return new OpaPolicyEvaluator(instance, _logger);
  } catch (err) {
    _logger.warn("OPA bundle unavailable, falling back to JS evaluator", {
      path: _bundlePath,
      error: (err as Error).message,
    });
    return null;
  }
}
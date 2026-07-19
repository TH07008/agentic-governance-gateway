/**
 * Human-in-the-loop gateway.
 *
 * Requests review for actions that policies flagged as `require_review`,
 * waits for a decision (approve/deny) within a timeout, and verifies that
 * the action actually executed matches the one the human approved by hashing
 * the action at request time and comparing it at execution time.
 *
 * The `ReviewProvider` is pluggable so we can test the gateway without a real
 * Slack/email integration – the `MemoryReviewProvider` approves or denies
 * based on a callback.
 */
import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type { AgentAction, GovernanceDecision, ReviewRecord } from "../../types/index.js";
import type { Logger } from "../logger.js";

export interface ReviewProvider {
  requestReview(record: ReviewRecord): Promise<void>;
  /** Block until a decision arrives or the timeout elapses. */
  awaitDecision(record: ReviewRecord, timeoutSeconds: number): Promise<ReviewRecord>;
}

export interface HitlGatewayOptions {
  provider: ReviewProvider;
  timeoutSeconds: number;
  logger: Logger;
}

export class HitlGateway {
  constructor(private readonly opts: HitlGatewayOptions) {}

  /** Compute a stable hash of an action, used to verify execution integrity. */
  static hashAction(action: AgentAction): string {
    return createHash("sha256")
      .update(JSON.stringify({ ...action, timestamp: action.timestamp }))
      .digest("hex");
  }

  async requestReview(
    action: AgentAction,
    decision: GovernanceDecision,
  ): Promise<ReviewRecord> {
    if (!decision.requireReview) {
      throw new Error("Cannot request review for a decision without requireReview");
    }
    const record: ReviewRecord = {
      id: uuidv4(),
      action,
      decision,
      status: "pending",
      reviewers: decision.requireReview.reviewers,
      actionHash: HitlGateway.hashAction(action),
      requestedAt: new Date().toISOString(),
    };
    this.opts.logger.info("Review requested", {
      id: record.id,
      tool: action.tool,
      reviewers: record.reviewers,
    });
    await this.opts.provider.requestReview(record);
    const decided = await this.opts.provider.awaitDecision(
      record,
      decision.requireReview.timeoutSeconds ?? this.opts.timeoutSeconds,
    );
    return decided;
  }

  /** Verify an action matches the one that was approved. */
  verifyExecution(record: ReviewRecord, action: AgentAction): boolean {
    return record.actionHash === HitlGateway.hashAction(action);
  }
}

/**
 * In-memory review provider used by tests and local dev. The `resolver`
 * callback decides whether a review is approved or denied.
 */
export class MemoryReviewProvider implements ReviewProvider {
  constructor(
    private readonly resolver: (record: ReviewRecord) => "approved" | "denied" = () => "approved",
    private readonly delayMs: number = 0,
  ) {}

  async requestReview(_record: ReviewRecord): Promise<void> {
    /* notify would happen here in a real provider */
  }

  async awaitDecision(record: ReviewRecord, timeoutSeconds: number): Promise<ReviewRecord> {
    const decided = await Promise.race([
      new Promise<ReviewRecord>((resolve) => {
        const status = this.resolver(record);
        const settled: ReviewRecord = {
          ...record,
          status,
          decidedAt: new Date().toISOString(),
          decidedBy: record.reviewers[0] ?? "reviewer",
        };
        if (this.delayMs > 0) {
          setTimeout(() => resolve(settled), this.delayMs);
        } else {
          resolve(settled);
        }
      }),
      new Promise<ReviewRecord>((resolve) => {
        setTimeout(
          () => resolve({ ...record, status: "expired" }),
          timeoutSeconds * 1000,
        );
      }),
    ]);
    return decided;
  }
}

/** A review provider that never resolves (used to test timeout handling). */
export class HangingReviewProvider implements ReviewProvider {
  async requestReview(): Promise<void> {}
  async awaitDecision(record: ReviewRecord, timeoutSeconds: number): Promise<ReviewRecord> {
    return new Promise<ReviewRecord>((resolve) =>
      setTimeout(() => resolve({ ...record, status: "expired" }), timeoutSeconds * 1000),
    );
  }
}
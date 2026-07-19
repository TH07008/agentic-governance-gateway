import { describe, it, expect } from "vitest";
import { HitlGateway, MemoryReviewProvider, HangingReviewProvider } from "../../src/core/hitl/gateway.js";
import { makeAction } from "../../src/core/traceability/store.js";
import type { GovernanceDecision } from "../../src/types/index.js";
import { CapturingLogger } from "../../src/core/logger.js";

const reviewDecision: GovernanceDecision = {
  action: "require_review",
  reason: "openapi change",
  requireReview: { reviewers: ["lead-dev"], timeoutSeconds: 1, summary: "openapi change" },
};

describe("HitlGateway.hashAction", () => {
  it("returns a stable hex string for the same action", () => {
    const a = makeAction({ agentId: "a", tool: "t", timestamp: "2026-01-01T00:00:00Z" });
    const b = makeAction({ id: a.id, agentId: "a", tool: "t", timestamp: "2026-01-01T00:00:00Z" });
    expect(HitlGateway.hashAction(a)).toEqual(HitlGateway.hashAction(b));
  });

  it("returns a different hash when any field changes", () => {
    const a = makeAction({ agentId: "a", tool: "t", timestamp: "2026-01-01T00:00:00Z" });
    const b = makeAction({ id: a.id, agentId: "a", tool: "other", timestamp: "2026-01-01T00:00:00Z" });
    expect(HitlGateway.hashAction(a)).not.toEqual(HitlGateway.hashAction(b));
  });
});

describe("MemoryReviewProvider", () => {
  it("approves immediately when the resolver returns approved", async () => {
    const gw = new HitlGateway({
      provider: new MemoryReviewProvider(() => "approved"),
      timeoutSeconds: 5,
      logger: new CapturingLogger(),
    });
    const action = makeAction({ agentId: "a", tool: "git_push" });
    const record = await gw.requestReview(action, reviewDecision);
    expect(record.status).toBe("approved");
    expect(gw.verifyExecution(record, action)).toBe(true);
  });

  it("denies when the resolver returns denied", async () => {
    const gw = new HitlGateway({
      provider: new MemoryReviewProvider(() => "denied"),
      timeoutSeconds: 5,
      logger: new CapturingLogger(),
    });
    const record = await gw.requestReview(makeAction({ agentId: "a", tool: "t" }), reviewDecision);
    expect(record.status).toBe("denied");
  });

  it("expires when the provider hangs past the timeout", async () => {
    const gw = new HitlGateway({
      provider: new HangingReviewProvider(),
      timeoutSeconds: 0.05 as unknown as number, // 50ms
      logger: new CapturingLogger(),
    });
    // requireReview.timeoutSeconds must be a positive integer; override here.
    const decision: GovernanceDecision = {
      ...reviewDecision,
      requireReview: { reviewers: ["lead-dev"], timeoutSeconds: 0.05 as unknown as number, summary: "x" },
    };
    const record = await gw.requestReview(makeAction({ agentId: "a", tool: "t" }), decision);
    expect(record.status).toBe("expired");
  });

  it("detects that the action drifted after approval (hash mismatch)", async () => {
    const gw = new HitlGateway({
      provider: new MemoryReviewProvider(() => "approved"),
      timeoutSeconds: 5,
      logger: new CapturingLogger(),
    });
    const action = makeAction({ agentId: "a", tool: "git_push", params: { paths: ["a"] } });
    const record = await gw.requestReview(action, reviewDecision);
    const drifted = makeAction({ id: action.id, agentId: "a", tool: "git_push", params: { paths: ["b"] } });
    expect(gw.verifyExecution(record, drifted)).toBe(false);
  });
});
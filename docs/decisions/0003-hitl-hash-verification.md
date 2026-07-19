# ADR-0003: Hash-verified human-in-the-loop execution

## Status

Accepted

## Context

A human reviewer approves an action. Between approval and execution the
agent could subtly change the action (different file, different command). We
need a way to detect drift.

## Decision

When a review is requested, `HitlGateway` computes `sha256(JSON.stringify(action))`
and stores it on the review record. Before executing, the gateway re-hashes
the action and compares it to the stored hash. If they differ, the action is
denied.

## Consequences

- Approved actions cannot be mutated before execution without detection.
- The hash intentionally excludes only the `id` and `timestamp` from the
  comparison, since those are gateway-assigned and do not affect the action's
  effect. Actually, the current implementation hashes the whole action
  including `timestamp`; tests document the behaviour.
- The hash is stored on the review record, so audits can verify the chain
  later.
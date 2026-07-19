# ADR-0001: OPA is optional, with a TypeScript fallback

## Status

Accepted

## Context

The gateway needs a policy engine. OPA/Rego is the de-facto standard for
policy-as-code, but requiring OPA in every environment (laptops, CI, air-gapped
networks) would make the project harder to adopt. The policy rules themselves
are simple enough that they can be expressed in TypeScript without losing
expressiveness.

## Decision

Ship two evaluators that implement the same `PolicyEvaluator` interface:

1. `OpaPolicyEvaluator` — loaded from a WASM bundle when available.
2. `JsPolicyEvaluator` — always available, mirrors the Rego policies.

`PolicyEngine.create` prefers OPA when a bundle path is provided and the
bundle can be loaded; otherwise it falls back to the JS evaluator.

A parity test (`tests/integration/policy-parity.test.ts`) verifies both
evaluators return the same decision for a shared set of inputs.

## Consequences

- Local development and CI work with **zero external dependencies**.
- Enterprises that already run OPA get the full Rego story (bundles, unit
  tests with `opa test`, integration with existing OPA infrastructure).
- Every change to a policy must be mirrored in both `policies/*.rego` and
  `src/core/policy-engine/rules.ts` and verified by the parity test.
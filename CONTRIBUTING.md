# Contributing

Thanks for your interest in improving the Agentic Governance Gateway.

## Development

```bash
npm install
npm run build
npm test
```

To run only the Rego tests (requires OPA):

```bash
opa test policies/ -v
```

To run the parity test (TypeScript vs Rego), install OPA on your PATH and run:

```bash
npm run test:integration
```

The parity test is skipped automatically when `opa` is not available.

## Adding a policy

1. Add the rule to `policies/agentic_gateway.rego`.
2. Mirror it in `src/core/policy-engine/rules.ts`.
3. Add a unit test in `tests/unit/policy-rules.test.ts`.
4. Add a Rego test in `policies/agentic_gateway_test.rego`.
5. Add a parity case in `tests/integration/policy-parity.test.ts`.

The parity test will catch divergences between the two implementations.

## Adding a checker

Implement the `Checker` interface from `src/core/validation/orchestrator.ts`
and pass it to `ValidationOrchestrator`. Add a unit test in
`tests/unit/validation.test.ts`.

## Code style

- TypeScript strict mode, no implicit any.
- ESM modules (`type: "module"`).
- 100 column width, 2-space indent, double quotes (enforced by Prettier).
- Conventional commit messages are appreciated but not enforced yet.

## Releasing

1. Update `CHANGELOG.md`.
2. Bump `version` in `package.json`.
3. Tag the commit `vX.Y.Z`.
4. GitHub Actions publishes the package.
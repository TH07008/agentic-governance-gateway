# Architecture

## Goal

Provide a governance control plane that any coding agent can talk to,
without forcing the operator to depend on a specific LLM provider, IDE, or
policy engine. The project must be fully usable in local development and CI
with **zero API keys**.

## Pipeline

Every action the gateway processes follows the same pipeline. Each step is
side-effect-free except the final executor, so the pipeline is deterministic
and testable.

```
                 ┌─────────────┐
AgentAction ───▶ │ Budget      │── allow ──▶ ┌─────────────┐
                 │ check       │             │ Policy      │
                 └─────────────┘             │ evaluation  │
                     │deny                    └─────────────┘
                     ▼                             │allow
                  deny ◀────────────  validation  │require_review
                                         fails      ▼
                                              ┌─────────────┐
                                              │ HITL gateway│
                                              └─────────────┘
                                                  │approved
                                                  ▼
                                              ┌─────────────┐
                                              │  Executor   │
                                              └─────────────┘
                                                  │
                                                  ▼
                                              ┌─────────────┐
                                              │ Audit + cost│
                                              └─────────────┘
```

## Modules

### Policy Engine (`src/core/policy-engine`)

Two evaluators implement the same `PolicyEvaluator` interface:

- `OpaPolicyEvaluator` — loads an OPA WASM bundle. Optional.
- `JsPolicyEvaluator` — pure TypeScript. Always available, mirrors the Rego
  rules. Used as fallback and as the reference implementation.

A `CompositeEvaluator` runs both and returns the strongest decision
(deny > review > allow).

### Traceability (`src/core/traceability`)

`TraceStore` is the interface. `MemoryTraceStore` is used by tests; the
SQL-backed `SqlTraceStore` writes parameterised queries against an injected
driver so it works with PostgreSQL, SQLite, or fakes in tests. Every record
carries a W3C PROV-O provenance block.

### Validation (`src/core/validation`)

`ValidationOrchestrator` runs pluggable `Checker`s in parallel.
`StaticChecker` returns a canned result; `ScriptChecker` wraps a shell command
and decides pass/fail from the exit code. Real checkers (semgrep, checkov,
npm test) are wired with `ScriptChecker` in production deployments.

### Human-in-the-loop (`src/core/hitl`)

`HitlGateway.requestReview` asks a `ReviewProvider` for a decision and waits
with a timeout. `HitlGateway.hashAction` hashes the action at request time;
`verifyExecution` checks the hash at execution time, so the agent cannot
silently change what the human approved.

### Budget (`src/core/budget`)

`BudgetController` estimates the USD cost of an action using a small price
table, checks it against per-agent daily/monthly caps, and charges the
estimated cost after execution.

### Gateway (`src/core/gateway`)

`Gateway.process` is the canonical pipeline. It is framework-agnostic — the
MCP server, REST API, and CLI all wrap it.

## Transports

- **MCP** (`src/mcp`) — the primary transport. Designed for stdio so it
  drops into Claude Code / Cursor. Three tools are exposed.
- **REST** (`src/api`) — optional sidecar surface for non-MCP clients.
- **CLI** (`src/cli`) — for ad-hoc checks and demos.

## Decisions

See [decisions/](decisions/) for ADRs.
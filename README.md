# Agentic Governance Gateway

> An open-source governance layer that sits between coding agents and your systems.
> Policies, provenance, validation and human-in-the-loop — without an API key.

[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)](https://nodejs.org/)
[![OPA](https://img.shields.io/badge/OPA-optional-7c3db8)](https://www.openpolicyagent.org/)

## Why does this exist?

Agentic coding tools (Claude Code, Cursor, Copilot, …) generate code faster
than humans can review it. The 2026 industry reports agree on one thing:
**governance is the bottleneck**, not code generation.

- 92 % of enterprises report governance challenges with AI-generated code.
- 82 % had at least one production incident caused by AI-generated code in the
  last six months.
- 60 % deploy untested AI-generated code.
- 43 % cannot reliably tell whether code was written by a human or an agent.

`agentic-governance-gateway` is a small, framework-agnostic control plane
that sits in front of any tool an agent wants to call. Every action flows
through one canonical pipeline:

```
AgentAction
  → Budget check          (cost estimation, daily/monthly caps)
  → Policy evaluation      (OPA/Rego when available, JS fallback otherwise)
  → Validation             (pluggable checkers: semgrep, npm test, checkov, …)
  → Human-in-the-loop      (review for sensitive actions, hash-verified execution)
  → Execution              (injected tool executor)
  → Audit + provenance     (W3C PROV-O records, immutable trail)
```

## Features

- **Policy-as-code** with OPA/Rego, plus a TypeScript fallback so the gateway
  works with zero external dependencies.
- **Traceability** with W3C PROV-O provenance and an in-memory or SQL store.
- **Validation orchestration** with pluggable checkers (StaticChecker and
  ScriptChecker ship out of the box).
- **Human-in-the-loop** with hash-verified execution: the action the human
  approved is the action that runs, or it is denied.
- **Budget & cost control** with per-agent daily/monthly caps.
- **MCP server** that drops into Claude Code, Cursor and any MCP-compatible
  client — no API key required.
- **REST API** for non-MCP clients.
- **CLI** for ad-hoc policy checks from the terminal.

## Quick start

```bash
npm install
npm run build
npm test            # unit + integration + rego tests
npm run test:e2e    # MCP handler end-to-end tests
```

Run the CLI:

```bash
node dist/cli/index.js policies              # list built-in rules
node dist/cli/index.js status               # show active evaluator
node dist/cli/index.js evaluate \
  --tool write_file \
  --params '{"path":"prod/secrets.yml"}' \
  --prompt "rotate the password"
# → decision: require_review / deny / allow
```

## Connecting an MCP client

`~/.cursor/mcp.json` (Cursor) or the equivalent for Claude Code:

```json
{
  "mcpServers": {
    "agentic-governance-gateway": {
      "command": "node",
      "args": ["/absolute/path/to/dist/mcp/main.js"]
    }
  }
}
```

The gateway then exposes three tools to the agent:

| Tool                     | Purpose                                            |
| ------------------------ | -------------------------------------------------- |
| `governed_tool_call`     | Submit a tool call through the governance pipeline |
| `governance_status`      | Report evaluator + budget snapshot                 |
| `governance_audit_lookup`| Fetch an audit record by action id                  |

Agents are expected to call `governed_tool_call` instead of touching files,
git or shell commands directly.

## Testing without an API key

The project is explicitly designed to be developed and tested with **no
Claude/OpenAI account**:

- The policy engine has a pure TypeScript evaluator (`JsPolicyEvaluator`)
  that mirrors the Rego policies exactly — no LLM involved.
- The MCP server is exercised end-to-end via a fake in-process server in
  `tests/e2e/mcp-handlers.test.ts`.
- Rego policies are unit-tested with `opa test policies/` (the CI job
  installs OPA automatically).
- A cross-implementation parity test (`tests/integration/policy-parity.test.ts`)
  verifies the TS and Rego evaluators agree on a shared set of inputs. It is
  skipped automatically when `opa` is not on PATH.
- For full agent loops, point the gateway at a local Ollama model
  (`model: "llama3:70b"`) — cost estimation returns 0 and no external API is
  called.

## Project layout

```
agentic-governance-gateway/
├── src/
│   ├── core/
│   │   ├── policy-engine/   OPA + JS evaluator, rules
│   │   ├── traceability/    Audit store, PROV-O provenance
│   │   ├── validation/      Pluggable checkers + orchestrator
│   │   ├── hitl/            Human-in-the-loop gateway
│   │   ├── budget/          Cost controller
│   │   ├── gateway.ts        Canonical pipeline façade
│   │   ├── config.ts
│   │   └── logger.ts
│   ├── mcp/                 MCP server + entrypoint
│   ├── api/                 REST API
│   ├── cli/                 CLI
│   └── types/                Shared TypeScript types
├── policies/                Rego policies + tests
├── tests/
│   ├── unit/                Per-module unit tests
│   ├── integration/         Gateway + parity tests
│   └── e2e/                 MCP handler tests
├── docs/                    Architecture + ADRs
├── examples/                Runnable example policies & configs
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full design and
[docs/decisions/](docs/decisions/) for the ADRs that explain the trade-offs
(OPA optional, in-memory vs SQL stores, MCP vs REST, …).

## License

MIT — see [LICENSE](LICENSE).
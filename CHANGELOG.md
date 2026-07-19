# Changelog

All notable changes to this project will be documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Initial public release of the Agentic Governance Gateway.
- Policy engine with OPA/Rego + TypeScript fallback (`JsPolicyEvaluator`).
- Traceability layer with W3C PROV-O provenance and in-memory/SQL stores.
- Validation orchestrator with `StaticChecker` and `ScriptChecker`.
- Human-in-the-loop gateway with hash-verified execution.
- Budget & cost controller with per-agent daily/monthly caps.
- MCP server exposing `governed_tool_call`, `governance_status`,
  `governance_audit_lookup`.
- REST API with `/evaluate`, `/process`, `/status/:agent`, `/audit/:id`,
  `/healthz`.
- CLI with `policies`, `status`, `evaluate` commands.
- Rego policy set with `opa test` unit tests and a TS/Rego parity test.
- Dockerfile and docker-compose deployment.
- GitHub Actions CI job (TypeScript + OPA).
- ADRs documenting the major architectural decisions.
# ADR-0002: MCP-first, REST optional

## Status

Accepted

## Context

The gateway needs a transport. Coding agents are converging on the Model
Context Protocol (MCP), which Cursor, Claude Code and others support natively.
REST is still useful for sidecar deployments and for callers that are not
MCP-aware.

## Decision

Treat MCP as the primary transport (`src/mcp`). The MCP server exposes three
tools: `governed_tool_call`, `governance_status`, `governance_audit_lookup`.
Run over stdio so it can be referenced from an MCP client's config with no
extra infrastructure.

Provide an optional REST API (`src/api`) using only Node's built-in `http`
module, so no extra dependencies are introduced.

## Consequences

- The gateway is usable from any MCP-compatible client with no API key.
- REST users get a small, dependency-free HTTP surface.
- The CLI is just a thin wrapper around the same `Gateway.process` call.
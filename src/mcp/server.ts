/**
 * MCP (Model Context Protocol) server that exposes the gateway as a set of
 * tools coding agents can call. Designed to be launchable via `stdio` so it
 * drops into Claude Code, Cursor, or any MCP-compatible client without an
 * API key.
 *
 * Tools exposed:
 *   - `governed_tool_call`     – the main entry point agents should use for
 *                               any mutating action (write_file, git_push, …)
 *   - `governance_status`       – report current evaluator, budget snapshot
 *   - `governance_audit_lookup` – fetch an audit record by id
 *
 * The server is transport-agnostic: `startStdio` uses stdio, but tests can use
 * `createInMemoryServer` to exercise handlers directly.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { AgentAction } from "../types/index.js";
import { Gateway } from "../core/gateway.js";
import { Logger } from "../core/logger.js";
import { BudgetController } from "../core/budget/controller.js";
import { TraceStore } from "../core/traceability/store.js";

const GovernedToolCallSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  tool: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  prompt: z.string().default(""),
  model: z.string().default("unknown"),
  iteration: z.number().int().nonnegative().optional(),
  parentActionId: z.string().optional(),
});

const StatusSchema = z.object({
  agentId: z.string().min(1),
});

const AuditLookupSchema = z.object({
  actionId: z.string().min(1),
});

export interface McpServerDeps {
  gateway: Gateway;
  budgetController: BudgetController;
  traceStore: TraceStore;
  logger: Logger;
  /** Server identity reported to the client. */
  name: string;
  version: string;
}

export function defineTools() {
  return [
    {
      name: "governed_tool_call",
      description:
        "Submit a tool call from a coding agent through the governance gateway. The gateway evaluates policies, runs validations, requests human review when needed, and only then executes the call.",
      inputSchema: {
        type: "object" as const,
        properties: {
          agentId: { type: "string", description: "Stable agent identifier (e.g. 'claude-code')" },
          sessionId: { type: "string", description: "Session identifier" },
          tool: { type: "string", description: "Underlying tool to call (e.g. 'write_file')" },
          params: { type: "object", description: "Parameters for the underlying tool" },
          prompt: { type: "string", description: "Original user prompt, if available" },
          model: { type: "string", description: "Model id (e.g. 'claude-3-opus')" },
          iteration: { type: "integer", description: "Iteration count for this task" },
          parentActionId: { type: "string", description: "Parent action id, if part of a chain" },
        },
        required: ["agentId", "sessionId", "tool", "model"],
      },
    },
    {
      name: "governance_status",
      description:
        "Report the current gateway status: policy evaluator in use and the budget snapshot for an agent.",
      inputSchema: {
        type: "object" as const,
        properties: { agentId: { type: "string" } },
        required: ["agentId"],
      },
    },
    {
      name: "governance_audit_lookup",
      description: "Look up a previously recorded audit record by action id.",
      inputSchema: {
        type: "object" as const,
        properties: { actionId: { type: "string" } },
        required: ["actionId"],
      },
    },
  ];
}

/** Wire handlers onto a Server instance. Exported so tests can call directly. */
export function attachHandlers(server: Server, deps: McpServerDeps): void {
  server.setRequestHandler(ListToolsRequestSchema, async (_req: ListToolsRequest) => ({
    tools: defineTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
    const { name, arguments: args } = req.params;
    try {
      if (name === "governed_tool_call") {
        const parsed = GovernedToolCallSchema.parse(args ?? {});
        const result = await deps.gateway.process(parsed);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  action: "governed_tool_call",
                  decision: result.decision,
                  actionId: result.audit.action.id,
                  result: result.result,
                  costUsd: result.costUsd,
                },
                null,
                2,
              ),
            },
          ],
          isError: result.decision.action === "deny",
        };
      }
      if (name === "governance_status") {
        const { agentId } = StatusSchema.parse(args ?? {});
        const snapshot = await deps.budgetController.snapshot(agentId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(snapshot, null, 2),
            },
          ],
        };
      }
      if (name === "governance_audit_lookup") {
        const { actionId } = AuditLookupSchema.parse(args ?? {});
        const record = await deps.traceStore.get(actionId);
        return {
          content: [
            {
              type: "text" as const,
              text: record ? JSON.stringify(record, null, 2) : `No audit record for ${actionId}`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  });
}

/** Start the gateway as a stdio MCP server. */
export async function startStdioServer(deps: McpServerDeps): Promise<void> {
  const server = new Server(
    { name: deps.name, version: deps.version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  attachHandlers(server, deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  deps.logger.info("MCP server started (stdio)", { name: deps.name });
}

export { uuidv4 };
export type { AgentAction };
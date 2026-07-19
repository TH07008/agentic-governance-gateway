/**
 * Optional REST API surface for the gateway. Useful when you want to run the
 * gateway as a sidecar and call it from non-MCP clients. The implementation is
 * framework-free: it uses Node's built-in http module so there are no extra
 * dependencies.
 *
 * Routes:
 *   POST /evaluate      – evaluate an action (no execution)
 *   POST /process       – full gateway flow (policy + validation + hitl + exec)
 *   GET  /status/:agent – budget snapshot
 *   GET  /audit/:id     – audit record lookup
 *   GET  /healthz       – liveness
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { Gateway } from "../core/gateway.js";
import { BudgetController } from "../core/budget/controller.js";
import { TraceStore } from "../core/traceability/store.js";
import { Logger } from "../core/logger.js";

const ProcessSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  tool: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  prompt: z.string().default(""),
  model: z.string().default("unknown"),
  iteration: z.number().int().nonnegative().optional(),
  parentActionId: z.string().optional(),
});

export interface ApiDeps {
  gateway: Gateway;
  budgetController: BudgetController;
  traceStore: TraceStore;
  logger: Logger;
  port: number;
}

export function createApiServer(deps: ApiDeps): Server {
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    try {
      if (req.method === "GET" && req.url === "/healthz") {
        return json(res, 200, { ok: true });
      }
      if (req.method === "GET" && req.url?.startsWith("/status/")) {
        const agentId = decodeURIComponent(req.url.slice("/status/".length));
        const snapshot = await deps.budgetController.snapshot(agentId);
        return json(res, 200, snapshot);
      }
      if (req.method === "GET" && req.url?.startsWith("/audit/")) {
        const id = decodeURIComponent(req.url.slice("/audit/".length));
        const record = await deps.traceStore.get(id);
        return record ? json(res, 200, record) : json(res, 404, { error: "not found" });
      }
      if (req.method === "POST" && (req.url === "/process" || req.url === "/evaluate")) {
        const body = await readJson(req);
        const parsed = ProcessSchema.parse(body);
        if (req.url === "/evaluate") {
          const decision = await deps.gateway.process(parsed);
          return json(res, 200, decision);
        }
        const result = await deps.gateway.process(parsed);
        return json(res, 200, result);
      }
      return json(res, 404, { error: "not found" });
    } catch (err) {
      deps.logger.warn("api error", { error: (err as Error).message });
      return json(res, 400, { error: (err as Error).message });
    }
  });
  return server;
}

export function startApiServer(deps: ApiDeps): Promise<Server> {
  return new Promise((resolve) => {
    const server = createApiServer(deps);
    server.listen(deps.port, () => {
      deps.logger.info("REST API listening", { port: deps.port });
      resolve(server);
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
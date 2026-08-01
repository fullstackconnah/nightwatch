import { JSON_RPC_ERROR_CODES, McpError } from "./errors";
import { LOG_RESOURCE_TEMPLATE, listResources, readResource } from "./resources";
import { TOOLS, callTool } from "./tools";

/**
 * Hand-rolled JSON-RPC 2.0 dispatcher for the Streamable HTTP MCP transport
 * (no SDK — see docs/superpowers/specs/2026-08-01-nightwatch-expansion-design.md
 * §3). This module is pure: no Next.js types, no I/O of its own beyond what
 * resources.ts/tools.ts do — the route handler (src/app/api/mcp/route.ts)
 * only turns HTTP <-> these functions.
 *
 * Deliberately out of scope, per the design doc: SSE server push,
 * subscriptions, prompts, and JSON-RPC batch requests (batching was removed
 * from MCP as of protocol version 2025-06-18, so a batch array is simply an
 * Invalid Request here, not a special case to support).
 */

export const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "nightwatch", version: "0.1.0" };

export type JsonRpcId = string | number | null;

export interface JsonRpcRequestBody {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
}

export interface JsonRpcResponseBody {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function errorBody(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponseBody {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function resultBody(id: JsonRpcId, result: unknown): JsonRpcResponseBody {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Validates the decoded HTTP body is a well-formed JSON-RPC 2.0 request
 * envelope. Throws McpError(INVALID_REQUEST) — the route handler is
 * responsible for JSON.parse itself and mapping *that* failure to
 * PARSE_ERROR, since a body that never parsed has no `id` to reply with.
 */
export function parseJsonRpcRequest(raw: unknown): JsonRpcRequestBody {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new McpError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Request body must be a single JSON-RPC 2.0 object (batch requests are not supported).",
    );
  }
  const body = raw as JsonRpcRequestBody;
  if (body.jsonrpc !== "2.0") {
    throw new McpError(JSON_RPC_ERROR_CODES.INVALID_REQUEST, '"jsonrpc" must be "2.0".');
  }
  if (typeof body.method !== "string" || body.method.length === 0) {
    throw new McpError(JSON_RPC_ERROR_CODES.INVALID_REQUEST, '"method" must be a non-empty string.');
  }
  return body;
}

/** A JSON-RPC notification carries no `id` at all and receives no response. */
export function isNotification(body: JsonRpcRequestBody): boolean {
  return !("id" in body) || body.id === undefined;
}

/**
 * Dispatches one validated request. Returns null for notifications — the
 * route handler turns that into an empty 202 response, per the Streamable
 * HTTP transport's rule that responses/notifications get no JSON-RPC body.
 */
export async function handleJsonRpcRequest(body: JsonRpcRequestBody): Promise<JsonRpcResponseBody | null> {
  if (isNotification(body)) {
    // Only "notifications/initialized" is expected from a real client; any
    // other notification-shaped call is still accepted silently rather than
    // erroring, since a notification's sender by definition ignores replies.
    return null;
  }

  const id: JsonRpcId = body.id ?? null;
  const method = body.method as string;
  const params = (body.params ?? {}) as Record<string, unknown>;

  try {
    switch (method) {
      case "initialize":
        return resultBody(id, handleInitialize(params));
      case "ping":
        return resultBody(id, {});
      case "resources/list":
        return resultBody(id, { resources: await listResources() });
      case "resources/templates/list":
        return resultBody(id, { resourceTemplates: [LOG_RESOURCE_TEMPLATE] });
      case "resources/read":
        return resultBody(id, await handleResourcesRead(params));
      case "tools/list":
        return resultBody(id, { tools: TOOLS });
      case "tools/call":
        return resultBody(id, await handleToolsCall(params));
      default:
        throw new McpError(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, `Method not found: "${method}".`);
    }
  } catch (e) {
    if (e instanceof McpError) return errorBody(id, e.code, e.message, e.data);
    const message = e instanceof Error ? e.message : String(e);
    return errorBody(id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message);
  }
}

function handleInitialize(params: Record<string, unknown>) {
  const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : undefined;
  const protocolVersion =
    requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSION;
  return {
    protocolVersion,
    capabilities: { resources: {}, tools: {} },
    serverInfo: SERVER_INFO,
  };
}

async function handleResourcesRead(params: Record<string, unknown>) {
  const uri = params.uri;
  if (typeof uri !== "string" || uri.length === 0) {
    throw new McpError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, '"uri" (string) is required.');
  }
  const content = await readResource(uri);
  return { contents: [content] };
}

async function handleToolsCall(params: Record<string, unknown>) {
  const name = params.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new McpError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, '"name" (string) is required.');
  }
  return callTool(name, params.arguments);
}

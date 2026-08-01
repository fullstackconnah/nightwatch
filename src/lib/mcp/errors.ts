/**
 * Shared error vocabulary for the hand-rolled MCP server (src/lib/mcp/*).
 * Kept import-free and tiny on purpose: both protocol.ts and resources.ts
 * throw McpError, so it lives in its own leaf to avoid a protocol.ts <->
 * resources.ts import cycle.
 */

/** Standard JSON-RPC 2.0 codes plus the MCP-reserved -32000..-32099 range
 * used here for one domain error (unknown resource URI). */
export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  RESOURCE_NOT_FOUND: -32002,
} as const;

/** Carries a JSON-RPC error code end-to-end so the dispatcher never has to
 * guess which code a failure deserves. */
export class McpError extends Error {
  code: number;
  data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, mcpEnabled } from "@/lib/mcp/auth";
import { JSON_RPC_ERROR_CODES, McpError } from "@/lib/mcp/errors";
import { handleJsonRpcRequest, parseJsonRpcRequest } from "@/lib/mcp/protocol";

/**
 * Streamable HTTP MCP transport, hand-rolled (no SDK — PRODUCT.md forbids
 * casual runtime deps). POST-only JSON-RPC 2.0: this app doesn't need the
 * transport's optional SSE/GET half, so GET returns 405 rather than
 * pretending to support server push.
 *
 * All protocol logic lives in src/lib/mcp/*; this handler only turns HTTP
 * into/out of it: check the server is enabled, check the bearer token,
 * decode JSON, hand off, and shape the response.
 */

export const dynamic = "force-dynamic";

function disabledResponse() {
  return NextResponse.json(
    { error: "MCP server disabled — set MCP_TOKEN in the server environment to enable /api/mcp." },
    { status: 503 },
  );
}

export async function POST(req: NextRequest) {
  if (!mcpEnabled()) return disabledResponse();
  if (!isAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: JSON_RPC_ERROR_CODES.PARSE_ERROR, message: "Request body is not valid JSON." },
      },
      { status: 400 },
    );
  }

  let body;
  try {
    body = parseJsonRpcRequest(raw);
  } catch (e) {
    const err = e as McpError;
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: err.code, message: err.message } },
      { status: 400 },
    );
  }

  const response = await handleJsonRpcRequest(body);
  if (response === null) {
    // Notification: no JSON-RPC body, 202 Accepted per the Streamable HTTP
    // transport ("responses to notifications ... MUST NOT include a body").
    return new NextResponse(null, { status: 202 });
  }
  return NextResponse.json(response, { status: 200 });
}

export async function GET() {
  return NextResponse.json(
    { error: "GET is not supported by this endpoint — POST a JSON-RPC 2.0 request." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

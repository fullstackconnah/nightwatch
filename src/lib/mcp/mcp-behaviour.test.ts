import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";

// These modules import "@/lib/...", extensionless relative paths and "next/server", which plain node cannot resolve; map them for this process only.
const SRC = new URL("../../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  if (s === "next/server" || s === "next/headers") return next(s + ".js", c);
  if ((s.startsWith("./") || s.startsWith("../")) && !s.split("/").pop().includes(".")) return next(s + ".ts", c);
  return next(s, c);
}`));

// A stand-in Docker daemon on a local port: lists two containers and records every lifecycle call, so nothing real is touched.
const seen: string[] = [];
const OWN = { Id: "a".repeat(64), Names: ["/homelab-dashboard"], Image: "nightwatch:latest", State: "running", Status: "Up 1 hour", Labels: {}, Ports: [], Created: 1 };
const PLEX = { Id: "b".repeat(64), Names: ["/plex"], Image: "plex:latest", State: "running", Status: "Up 1 hour", Labels: {}, Ports: [], Created: 1 };
const daemon = http.createServer((req, res) => {
  seen.push(`${req.method} ${req.url}`);
  if (req.method === "GET" && req.url?.startsWith("/containers/json")) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify([OWN, PLEX]));
  } else {
    res.statusCode = 204;
    res.end();
  }
});
const lifecycle = () => seen.filter((s) => s.startsWith("POST"));

const ENV = ["DATA_DIR", "DOCKER_HOST", "MCP_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV) saved[k] = process.env[k];
let dir = "";
await new Promise<void>((r) => daemon.listen(0, "127.0.0.1", r));
dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-behaviour-"));
process.env.DATA_DIR = dir;
// dockerode is built from DOCKER_HOST when lib/docker.ts first loads, so set it before the imports below.
process.env.DOCKER_HOST = `tcp://127.0.0.1:${(daemon.address() as AddressInfo).port}`;
delete process.env.MCP_TOKEN;

const { callTool } = await import("./tools.ts");
const { handleJsonRpcRequest, parseJsonRpcRequest } = await import("./protocol.ts");
const { JSON_RPC_ERROR_CODES, McpError } = await import("./errors.ts");
const { NextRequest } = await import("next/server");
const route = await import("../../app/api/mcp/route.ts");

after(() => {
  daemon.close();
  daemon.closeAllConnections();
  fs.rmSync(dir, { recursive: true, force: true });
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  seen.length = 0;
});

const text = (r: { content: { text: string }[] }) => r.content[0].text;

describe("callTool", () => {
  it("refuses an unknown tool, including a prototype key", async () => {
    for (const name of ["container_delete", "constructor", "toString"]) {
      const r = await callTool(name, { name: "plex" });
      assert.equal(r.isError, true, name);
      assert.match(text(r), /Unknown tool/);
    }
    assert.deepEqual(lifecycle(), []);
  });

  it("refuses a missing, blank or non-string container name", async () => {
    for (const args of [undefined, null, {}, { name: "   " }, { name: 7 }, "plex"]) {
      const r = await callTool("container_stop", args);
      assert.equal(r.isError, true);
      assert.match(text(r), /missing required string argument "name"/);
    }
    assert.deepEqual(lifecycle(), []);
  });

  it("refuses stop and restart of nightwatch's own container, and never calls the daemon", async () => {
    for (const tool of ["container_stop", "container_restart"]) {
      const r = await callTool(tool, { name: "homelab-dashboard" });
      assert.equal(r.isError, true, tool);
      assert.match(text(r), /^Refused:/);
    }
    assert.deepEqual(lifecycle(), []);
  });

  it("still allows start of a protected container", async () => {
    const r = await callTool("container_start", { name: "homelab-dashboard" });
    assert.equal(r.isError, false);
    assert.deepEqual(lifecycle(), [`POST /containers/${OWN.Id}/start`]);
  });

  it("stops an ordinary container", async () => {
    const r = await callTool("container_stop", { name: "plex" });
    assert.equal(r.isError, false);
    assert.match(text(r), /stop succeeded for "plex"/);
    assert.equal(lifecycle().length, 1);
    assert.match(lifecycle()[0], new RegExp(`^POST /containers/${PLEX.Id}/stop`));
  });

  it("reports a container that does not exist", async () => {
    const r = await callTool("container_stop", { name: "nope" });
    assert.equal(r.isError, true);
    assert.match(text(r), /No container named "nope"/);
    assert.deepEqual(lifecycle(), []);
  });
});

describe("JSON-RPC protocol", () => {
  it("rejects a batch array and a body without a method", () => {
    for (const raw of [[{ jsonrpc: "2.0", id: 1, method: "ping" }], { jsonrpc: "2.0", id: 1 }, { jsonrpc: "1.0", id: 1, method: "ping" }, null]) {
      assert.throws(() => parseJsonRpcRequest(raw), (e) => e instanceof McpError && e.code === JSON_RPC_ERROR_CODES.INVALID_REQUEST);
    }
  });

  it("returns null (no reply) for a request without an id", async () => {
    assert.equal(await handleJsonRpcRequest({ jsonrpc: "2.0", method: "ping" }), null);
  });

  it("answers ping and an unknown method with the matching id", async () => {
    assert.deepEqual(await handleJsonRpcRequest({ jsonrpc: "2.0", id: 5, method: "ping" }), { jsonrpc: "2.0", id: 5, result: {} });
    const res = await handleJsonRpcRequest({ jsonrpc: "2.0", id: "x", method: "nope/nothing" });
    assert.equal(res?.id, "x");
    assert.equal(res?.error?.code, JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
  });

  it("rejects tools/call without a tool name as invalid params", async () => {
    const res = await handleJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} });
    assert.equal(res?.error?.code, JSON_RPC_ERROR_CODES.INVALID_PARAMS);
  });

  it("turns a refused tool call into a tool error result, not a protocol error", async () => {
    const res = await handleJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "container_stop", arguments: { name: "homelab-dashboard" } } });
    assert.equal(res?.error, undefined);
    assert.equal((res?.result as { isError: boolean }).isError, true);
    assert.deepEqual(lifecycle(), []);
  });
});

describe("POST /api/mcp", () => {
  afterEach(() => {
    delete process.env.MCP_TOKEN;
  });
  const post = (body: string, headers: Record<string, string> = {}) =>
    route.POST(new NextRequest("http://localhost/api/mcp", { method: "POST", body, headers: { "content-length": String(Buffer.byteLength(body)), ...headers } }));
  const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });

  it("answers 503 while no token is set, even with a bearer header", async () => {
    assert.equal((await post(ping, { authorization: "Bearer anything" })).status, 503);
  });

  it("answers 401 for a missing or wrong token", async () => {
    process.env.MCP_TOKEN = "test-only-mcp-token";
    assert.equal((await post(ping)).status, 401);
    assert.equal((await post(ping, { authorization: "Bearer wrong-token" })).status, 401);
    assert.equal((await post(ping, { authorization: "test-only-mcp-token" })).status, 401);
  });

  it("serves a request with the right token, 202s a notification and refuses a batch or bad JSON", async () => {
    process.env.MCP_TOKEN = "test-only-mcp-token";
    const auth = { authorization: "Bearer test-only-mcp-token" };
    const ok = await post(ping, auth);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { jsonrpc: "2.0", id: 1, result: {} });
    assert.equal((await post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), auth)).status, 202);
    assert.equal((await post(`[${ping}]`, auth)).status, 400);
    assert.equal((await post("{not json", auth)).status, 400);
  });

  // The cap runs after auth, so these carry a valid token: only the cap can refuse them.
  it("answers 411 with no Content-Length and 413 one byte over the 256 KB cap, with a valid token", async () => {
    process.env.MCP_TOKEN = "test-only-mcp-token";
    const auth = { authorization: "Bearer test-only-mcp-token" };
    const url = "http://localhost/api/mcp";
    const missing = await route.POST(new NextRequest(url, { method: "POST", body: ping, headers: auth }));
    assert.equal(missing.status, 411);
    const over = await post(ping, { ...auth, "content-length": String(256 * 1024 + 1) });
    assert.equal(over.status, 413);
    assert.equal((await over.json()).error.code, JSON_RPC_ERROR_CODES.INVALID_REQUEST);
  });
});

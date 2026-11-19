import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";

// The route imports "@/lib/..." and "next/server", which plain node cannot resolve; map them for this process only.
const SRC = new URL("../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  if (s === "next/server" || s === "next/headers") return next(s + ".js", c);
  if (s.startsWith(".") && !/\\.[a-z]+$/.test(s)) {
    try { return await next(s, c); } catch { return next(s + ".ts", c); }
  }
  return next(s, c);
}`));
const { NextRequest } = await import("next/server");
const { POST } = await import("../app/api/ha/action/route.ts");

// A 401 from this route is read by src/lib/client.ts as a lost dashboard session and sends the tab to /login.
const realFetch = globalThis.fetch;
const savedDataDir = process.env.DATA_DIR;
let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ha-action-401-"));
  process.env.DATA_DIR = dir;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

function configureHa() {
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ homeassistant: { url: "http://ha.invalid:8123", token: "test-token" } }));
}
const call = (entityId: string, action: string) =>
  POST(new NextRequest("http://localhost/api/ha/action", {
    method: "POST",
    body: JSON.stringify({ entityId, action }),
    headers: { "content-type": "application/json" },
  }));

describe("POST /api/ha/action status codes", () => {
  it("answers 502 (never 401) with the detail when Home Assistant rejects the stored token", async () => {
    configureHa();
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch;
    const res = await call("light.lamp", "toggle");
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /Home Assistant rejected the access token \(HTTP 401\)/);
  });

  it("pins existing behaviour: unconfigured answers 409", async () => {
    const res = await call("light.lamp", "toggle");
    assert.equal(res.status, 409);
  });

  it("pins existing behaviour: unreachable answers 502", async () => {
    configureHa();
    globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
    const res = await call("light.lamp", "toggle");
    assert.equal(res.status, 502);
  });

  it("pins existing behaviour: invalid answers 400", async () => {
    configureHa();
    globalThis.fetch = (async () => { throw new Error("must not be reached"); }) as typeof fetch;
    const res = await call("sensor.temp", "toggle");
    assert.equal(res.status, 400);
  });

  it("pins existing behaviour: a refusal from Home Assistant (error) answers 500", async () => {
    configureHa();
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    const res = await call("light.lamp", "toggle");
    assert.equal(res.status, 500);
  });
});

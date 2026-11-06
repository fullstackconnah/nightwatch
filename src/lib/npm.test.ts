import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { saveConfig } from "./config.ts";
import type { AppConfig } from "./config.ts";
import { getProxyManagerSnapshot } from "./npm.ts";

const realFetch = globalThis.fetch;
let dir: string;
let prevDataDir: string | undefined;
let calls: { method: string; url: string }[];

function setCreds(url: string, password: string) {
  saveConfig({ npm: { url, email: "admin@example.test", password } } as unknown as AppConfig);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Stub fetch: `tokens` answers the login, `target` answers probes of the upstream. */
function stub(opts: { tokens?: () => Promise<Response> | Response; target?: (method: string) => Response }) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url.endsWith("/api/tokens")) return (opts.tokens ?? (() => json({ token: "t" })))();
    if (url.endsWith("/proxy-hosts")) {
      return json([{ id: 1, domain_names: ["a.test"], forward_scheme: "http", forward_host: "up.test", forward_port: 80, enabled: 1, certificate_id: null }]);
    }
    if (url.includes("/api/nginx/")) return json([]);
    return (opts.target ?? (() => new Response("", { status: 200 })))(method);
  }) as typeof fetch;
}

const logins = () => calls.filter((c) => c.url.endsWith("/api/tokens")).length;

beforeEach(() => {
  prevDataDir = process.env.DATA_DIR;
  dir = mkdtempSync(join(tmpdir(), "nw-npm-"));
  process.env.DATA_DIR = dir;
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("route probes", () => {
  it("does not retry with GET after a HEAD timeout", async () => {
    setCreds("http://npm-probe.test:81", "pw");
    stub({
      target: () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    });
    const snap = await getProxyManagerSnapshot();
    assert.equal(snap.routes[0].health, "down");
    const probes = calls.filter((c) => c.url.startsWith("http://up.test"));
    assert.deepEqual(probes.map((p) => p.method), ["HEAD"]);
  });
});

describe("login", () => {
  it("shares one login between concurrent cold polls", async () => {
    setCreds("http://npm-concurrent.test:81", "pw");
    stub({ tokens: async () => json({ token: "t" }) });
    await Promise.all([getProxyManagerSnapshot(), getProxyManagerSnapshot()]);
    assert.equal(logins(), 1);
  });

  it("does not retry a rejected login within 60 s, but does once the password changes", async () => {
    setCreds("http://npm-401.test:81", "wrong");
    stub({ tokens: () => json({ error: "no" }, 401) });
    assert.equal((await getProxyManagerSnapshot()).status, "unauthorized");
    assert.equal((await getProxyManagerSnapshot()).status, "unauthorized");
    assert.equal(logins(), 1);
    setCreds("http://npm-401.test:81", "right");
    await getProxyManagerSnapshot();
    assert.equal(logins(), 2);
  });

  it("does not cache a network failure", async () => {
    setCreds("http://npm-net.test:81", "pw");
    stub({
      tokens: () => {
        throw new Error("down");
      },
    });
    assert.equal((await getProxyManagerSnapshot()).status, "unreachable");
    await getProxyManagerSnapshot();
    assert.equal(logins(), 2);
  });
});

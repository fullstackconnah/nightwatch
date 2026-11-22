import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";

// hermes-ctl.ts imports "@/lib/..." which plain node cannot resolve; map it for this process only.
const SRC = new URL("../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  return next(s, c);
}`));
const { getHermesJob, runHermesJob } = await import("./hermes-ctl.ts");

const ENV = ["DATA_DIR", "HERMES_API_URL", "HERMES_API_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let dir = "";
let calls: { url: string; init?: RequestInit }[] = [];

/** Replace global fetch: record each call, then answer with `reply` (or throw it when it is an Error). */
function stubFetch(reply: Response | Error) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (reply instanceof Error) throw reply;
    return reply;
  }) as typeof fetch;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-ctl-"));
  process.env.DATA_DIR = dir;
  process.env.HERMES_API_URL = "http://hermes.test:8765/";
  process.env.HERMES_API_TOKEN = "test-only-hermes-token";
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("runHermesJob", () => {
  it("is unconfigured, and never calls out, without a URL and token", async () => {
    delete process.env.HERMES_API_TOKEN;
    stubFetch(json(202, { jobId: "job-1" }));
    const r = await runHermesJob("digest");
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, "unconfigured");
    assert.equal(calls.length, 0);
  });

  it("posts the kind with the bearer token and returns a good job id", async () => {
    stubFetch(json(202, { jobId: "2026-11-17T12:00:00Z_digest:1" }));
    const r = await runHermesJob("ask", "is the disk full?");
    assert.deepEqual(r, { ok: true, jobId: "2026-11-17T12:00:00Z_digest:1" });
    assert.equal(calls[0].url, "http://hermes.test:8765/run");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer test-only-hermes-token");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { kind: "ask", question: "is the disk full?" });
  });

  it("refuses a daemon job id that is not one safe path segment", async () => {
    for (const jobId of ["../admin", "a/b", "..", "has space", "x".repeat(129)]) {
      stubFetch(json(202, { jobId }));
      const r = await runHermesJob("digest");
      assert.equal(r.ok, false, jobId);
      assert.match(!r.ok ? r.detail : "", /no usable jobId/);
    }
  });

  it("maps 409 to a conflict with the daemon's message, 401 to unauthorized and a throw to unreachable", async () => {
    stubFetch(json(409, { error: "a run is already going" }));
    const busy = await runHermesJob("digest");
    assert.deepEqual(busy, { ok: false, status: "conflict", detail: "a run is already going" });
    stubFetch(json(401, {}));
    assert.equal((await runHermesJob("digest") as { status: string }).status, "unauthorized");
    stubFetch(new Error("connect ECONNREFUSED"));
    assert.equal((await runHermesJob("digest") as { status: string }).status, "unreachable");
  });

  it("cuts a long 409 message at 200 characters and redacts a bearer token in it", async () => {
    stubFetch(json(409, { error: `Authorization: Bearer abc123 ${"x".repeat(400)}` }));
    const busy = (await runHermesJob("digest")) as { detail: string };
    assert.ok(busy.detail.length <= 200);
    assert.ok(!busy.detail.includes("abc123"));
  });

  it("keeps the Hermes URL and host out of the reason a person reads, and in the server log", async () => {
    const logged: string[] = [];
    const realError = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      for (const err of [new Error("connect ECONNREFUSED"), Object.assign(new Error("t"), { name: "TimeoutError" })]) {
        stubFetch(err);
        const r = (await runHermesJob("digest")) as { status: string; detail: string };
        assert.equal(r.status, "unreachable");
        assert.match(r.detail, /^Hermes (is not reachable|did not respond within \d+s)\.$/);
        assert.doesNotMatch(r.detail, /hermes\.test|8765|http/i);
      }
    } finally {
      console.error = realError;
    }
    assert.ok(logged.some((l) => l.includes("http://hermes.test:8765")), "the origin stays in the server log");
  });

  it("reports an unexpected HTTP status as an error", async () => {
    stubFetch(new Response("boom", { status: 500 }));
    const r = await runHermesJob("digest");
    assert.equal(!r.ok && r.status, "error");
    assert.match(!r.ok ? r.detail : "", /HTTP 500: boom/);
  });
});

describe("getHermesJob", () => {
  it("refuses a bad id before any fetch", async () => {
    stubFetch(json(200, { state: "done" }));
    for (const id of ["../status", "a/b", "..", "", "x".repeat(129)]) {
      const r = await getHermesJob(id);
      assert.equal(r.ok, false, id);
      assert.equal(!r.ok && r.detail, "Invalid job id.");
    }
    assert.equal(calls.length, 0);
  });

  it("fetches a good id and maps the body", async () => {
    stubFetch(json(200, { state: "done", kind: "digest", result: { title: "T", body: "B" } }));
    const r = await getHermesJob("job-1");
    assert.equal(calls[0].url, "http://hermes.test:8765/jobs/job-1");
    assert.equal(r.ok && r.job.state, "done");
    assert.deepEqual(r.ok && r.job.result, { title: "T", body: "B" });
  });

  it("maps 404 to not-found and a throw to unreachable", async () => {
    stubFetch(new Response("", { status: 404 }));
    assert.equal(((await getHermesJob("job-1")) as { status: string }).status, "not-found");
    stubFetch(new Error("connect ECONNREFUSED"));
    assert.equal(((await getHermesJob("job-1")) as { status: string }).status, "unreachable");
  });
});

describe("hermes-ctl log line", () => {
  it("never interpolates creds.url into the log", () => {
    const src = fs.readFileSync(new URL("./hermes-ctl.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /console\.error\([^)]*creds\.url/);
  });
});

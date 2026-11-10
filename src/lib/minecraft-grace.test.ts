import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { holdAfterTimeout, isBusy, tryBegin, TIMEOUT_GRACE_MS } from "./minecraft-busy.ts";
import { IntegrationClient } from "./integration-client.ts";

// A: the hold
test("holdAfterTimeout keeps the guard for the grace period, then frees it", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const release = tryBegin("restore")!;
    holdAfterTimeout(release);
    assert.equal(isBusy(), true);
    assert.equal(tryBegin("start"), null);
    mock.timers.tick(TIMEOUT_GRACE_MS - 1);
    assert.equal(isBusy(), true);
    mock.timers.tick(1);
    assert.equal(isBusy(), false);
  } finally {
    mock.timers.reset();
  }
});

test("a late or double release never drops another job's guard", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const first = tryBegin("run")!;
    holdAfterTimeout(first);
    mock.timers.tick(TIMEOUT_GRACE_MS);
    const second = tryBegin("start")!;
    first();
    assert.equal(isBusy(), true);
    second();
    assert.equal(isBusy(), false);
  } finally {
    mock.timers.reset();
  }
});

// B: the client tells a timeout from a refusal
class Client extends IntegrationClient<{ u: string }> {
  protected readonly displayName = "T";
  protected readonly timeoutMs = 1000;
  protected readonly unconfiguredDetail = "x";
  protected credentials() {
    return { u: "http://svc" };
  }
  protected baseUrl(c: { u: string }) {
    return c.u;
  }
  protected authHeaders() {
    return {};
  }
  get() {
    return this.request("/x");
  }
}

test("a TimeoutError maps to timedOut, a refused connection does not", async () => {
  const real = globalThis.fetch;
  const origError = console.error;
  console.error = () => {};
  try {
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch;
    const t = await new Client().get();
    assert.equal(t.status, "unreachable");
    assert.equal((t as { timedOut?: boolean }).timedOut, true);

    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const r = await new Client().get();
    assert.equal(r.status, "unreachable");
    assert.equal((r as { timedOut?: boolean }).timedOut, undefined);
  } finally {
    globalThis.fetch = real;
    console.error = origError;
  }
});

test("a real AbortSignal.timeout rejects with the name the client checks", async () => {
  const s = AbortSignal.timeout(1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((s.reason as Error).name, "TimeoutError");
});

// C: each route holds only on timedOut
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const routes = {
  backups: read("../app/api/minecraft/backups/route.ts"),
  activate: read("../app/api/minecraft/instances/[slug]/activate/route.ts"),
  del: read("../app/api/minecraft/instances/[slug]/route.ts"),
};

test("the four guarded call sites release through the hold only on a timeout", () => {
  const hold = /^\s+if \(probe\?\.timedOut\) holdAfterTimeout\(release\);\s*$/gm;
  const plain = /^\s+else release\(\);\s*$/gm;
  assert.equal(routes.backups.match(hold)?.length, 2);
  assert.equal(routes.backups.match(plain)?.length, 2);
  for (const src of [routes.activate, routes.del]) {
    assert.equal(src.match(hold)?.length, 1);
    assert.equal(src.match(plain)?.length, 1);
    assert.match(src, /^import \{[^}]*holdAfterTimeout[^}]*\} from "@\/lib\/minecraft-busy";$/m);
  }
});

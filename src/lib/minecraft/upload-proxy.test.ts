import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { isBusy, tryBegin, TIMEOUT_GRACE_MS } from "../minecraft-busy.ts";
import { guardedUpload } from "./upload-proxy.ts";

const COPY =
  "The Minecraft manager didn’t answer in time. The pack may still be installing, so check the list before you try again.";

// Fake timers also keep the 30 min hold from outliving the test; reset frees whatever a test held.
test.beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
test.afterEach(() => {
  mock.timers.tick(TIMEOUT_GRACE_MS);
  mock.timers.reset();
  assert.equal(isBusy(), false);
});

const run = (doFetch: () => Promise<Response>) => guardedUpload(tryBegin("upload")!, doFetch);

test("undici's own headers timeout answers 504 and keeps the busy guard", async () => {
  const answer = await run(() => Promise.reject(new TypeError("fetch failed", { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } })));
  assert.deepEqual(answer, { status: 504, body: { error: COPY } });
  assert.equal(isBusy(), true);
  assert.equal(tryBegin("start"), null);
});

test("our own AbortSignal.timeout answers 504 and keeps the busy guard", async () => {
  const answer = await run(() => Promise.reject(new DOMException("x", "TimeoutError")));
  assert.deepEqual(answer, { status: 504, body: { error: COPY } });
  assert.equal(isBusy(), true);
});

test("a refused connection answers 502 and frees the guard at once", async () => {
  const answer = await run(() => Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } })));
  assert.deepEqual(answer, { status: 502, body: { error: "Could not reach the Minecraft manager." } });
  assert.equal(isBusy(), false);
});

test("a 504 the manager itself returned frees the guard", async () => {
  const answer = await run(() => Promise.resolve(Response.json({ detail: "gateway" }, { status: 504 })));
  assert.deepEqual(answer, { status: 504, body: { error: "gateway" } });
  assert.equal(isBusy(), false);
});

test("a manager 401 reads as a 502 and the success body passes through", async () => {
  assert.equal((await run(() => Promise.resolve(Response.json({}, { status: 401 })))).status, 502);
  assert.deepEqual(await run(() => Promise.resolve(Response.json({ slug: "a" }, { status: 201 }))), { status: 201, body: { slug: "a" } });
});

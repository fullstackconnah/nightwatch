import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { isBusy, tryBegin, TIMEOUT_GRACE_MS } from "../minecraft-busy.ts";
import { guardedUpload, trackBodySent } from "./upload-proxy.ts";

const COPY =
  "The Minecraft manager didn’t answer in time. The pack may still be installing, so check the Installed list before you try again.";

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

test("a bare AbortError is not our timeout: it answers 502 and frees the guard", async () => {
  const answer = await run(() => Promise.reject(new DOMException("x", "AbortError")));
  assert.deepEqual(answer, { status: 502, body: { error: "Could not reach the Minecraft manager." } });
  assert.equal(isBusy(), false);
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

const NOT_SENT =
  "The upload didn’t finish within 10 minutes, so it was cut off before the whole pack was sent. Try again on a faster connection.";
const timeout = () => Promise.reject(new DOMException("x", "TimeoutError"));

test("a timeout while the body is still streaming frees the guard at once with the not-installed copy", async () => {
  const release = tryBegin("upload")!;
  const answer = await guardedUpload(release, timeout, () => false);
  assert.deepEqual(answer, { status: 504, body: { error: NOT_SENT } });
  assert.equal(isBusy(), false);
});

test("a timeout after the body was sent keeps the guard", async () => {
  const answer = await guardedUpload(tryBegin("upload")!, timeout, () => true);
  assert.deepEqual(answer, { status: 504, body: { error: COPY } });
  assert.equal(isBusy(), true);
});

test("a timeout with no bodySent argument keeps the guard (default)", async () => {
  const answer = await guardedUpload(tryBegin("upload")!, timeout);
  assert.deepEqual(answer, { status: 504, body: { error: COPY } });
  assert.equal(isBusy(), true);
});

test("trackBodySent is false until the stream is drained, and stays false when the reader cancels", async () => {
  const src = () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(2)); c.close(); } });
  const done = trackBodySent(src());
  assert.equal(done.sent(), false);
  await new Response(done.body).arrayBuffer();
  assert.equal(done.sent(), true);

  const cut = trackBodySent(src());
  await cut.body.cancel();
  assert.equal(cut.sent(), false);
});

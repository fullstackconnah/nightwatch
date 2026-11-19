import test, { after } from "node:test";
import assert from "node:assert/strict";
import { oneShotLogOptions } from "./log-read-options.ts";

// CI's Node 22 cancels a test that waits only on an unref'd timer (AbortSignal.timeout), so keep the loop alive.
const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

test("seed read keeps today's options and adds a deadline signal", () => {
  const { abortSignal, ...rest } = oneShotLogOptions(200, undefined, 2000, 10_000);
  assert.deepEqual(rest, { stdout: true, stderr: true, timestamps: true, follow: false, tail: 200 });
  assert.ok(abortSignal instanceof AbortSignal);
  assert.equal(abortSignal.aborted, false);
});

test("resume read keeps since (whole seconds) and the tail cap", () => {
  const { abortSignal, ...rest } = oneShotLogOptions(0, 1_700_000_123_456, 2000, 10_000);
  assert.deepEqual(rest, { stdout: true, stderr: true, timestamps: true, follow: false, since: 1_700_000_123, tail: 2000 });
  assert.ok(abortSignal instanceof AbortSignal);
});

test("the signal aborts at the deadline with a TimeoutError", async () => {
  const { abortSignal } = oneShotLogOptions(10, undefined, 2000, 30);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(abortSignal.aborted, true);
  assert.equal((abortSignal.reason as Error).name, "TimeoutError");
});

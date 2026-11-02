import test from "node:test";
import assert from "node:assert/strict";
import { reconnectDelay, shouldRetry, MAX_RECONNECT_ATTEMPTS } from "./log-reconnect.ts";

test("delay doubles from 1s and caps at 30s", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map(reconnectDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
test("retry on ended and on unknown container while attempts remain", () => {
  assert.equal(shouldRetry("ended", null, 0), true);
  assert.equal(shouldRetry("error", "unknown container", 3), true);
});
test("no retry for other errors, live, or once attempts are spent", () => {
  assert.equal(shouldRetry("error", "could not read scrollback", 0), false);
  assert.equal(shouldRetry("live", null, 0), false);
  assert.equal(shouldRetry("ended", null, MAX_RECONNECT_ATTEMPTS), false);
  assert.equal(shouldRetry("ended", null, MAX_RECONNECT_ATTEMPTS - 1), true);
});

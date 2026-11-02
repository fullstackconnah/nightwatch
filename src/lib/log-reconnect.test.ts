import test from "node:test";
import assert from "node:assert/strict";
import {
  reconnectDelay,
  shouldRetry,
  shouldResetAttempts,
  parseResume,
  readIdPrefix,
  MAX_RECONNECT_ATTEMPTS,
  MIN_LIVE_MS,
  SETTLED_MS,
  UNKNOWN_CONTAINER,
} from "./log-reconnect.ts";

test("delay doubles from 1s and caps at 30s", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map(reconnectDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
test("retry on ended and on unknown container once the track ran, while attempts remain", () => {
  assert.equal(shouldRetry("ended", null, 0, MIN_LIVE_MS), true);
  assert.equal(shouldRetry("error", UNKNOWN_CONTAINER, 3, null), true);
});
test("no retry for other errors, live, or once attempts are spent", () => {
  assert.equal(shouldRetry("error", "could not read scrollback", 0, MIN_LIVE_MS), false);
  assert.equal(shouldRetry("live", null, 0, MIN_LIVE_MS), false);
  assert.equal(shouldRetry("ended", null, MAX_RECONNECT_ATTEMPTS, MIN_LIVE_MS), false);
  assert.equal(shouldRetry("ended", null, MAX_RECONNECT_ATTEMPTS - 1, MIN_LIVE_MS), true);
});
test("a track that never ran is not retried: stopped or removed before the page opened", () => {
  // docker reports live for a moment before a stopped container's follow ends.
  assert.equal(shouldRetry("ended", null, 0, 50), false);
  assert.equal(shouldRetry("ended", null, 0, null), false);
  assert.equal(shouldRetry("error", UNKNOWN_CONTAINER, 0, null), false);
  // A retry already under way keeps going even if the new feed ended at once.
  assert.equal(shouldRetry("ended", null, 1, 50), true);
});

test("attempts reset only on a fresh line well after going live", () => {
  const liveAt = 1_000_000;
  assert.equal(shouldResetAttempts(liveAt, liveAt + SETTLED_MS, false), true);
  assert.equal(shouldResetAttempts(liveAt, liveAt + SETTLED_MS - 1, false), false);
  assert.equal(shouldResetAttempts(null, liveAt + SETTLED_MS, false), false);
  // A replayed line proves nothing about the container staying up.
  assert.equal(shouldResetAttempts(liveAt, liveAt + 10 * SETTLED_MS, true), false);
});

test("parseResume keeps only names with 0 < ts <= now", () => {
  const now = 2_000_000;
  const got = parseResume(" a:1500 ,b:,c,d:-5,e:2000001,f:abc,g:NaN,:9,h:x:2000000,i:0,j:Infinity", now);
  assert.deepEqual([...got], [["a", 1500], ["h:x", 2000000]]);
  assert.equal(parseResume(null, now).size, 0);
  assert.equal(parseResume("", now).size, 0);
});

test("line ids from separate reads never collide, and replay ids never equal seed ids", () => {
  const ids = new Set<string>();
  let made = 0;
  for (const source of ["s", "r", "l", "l", "r", "s"] as const) {
    for (let read = 0; read < 12; read++) {
      const prefix = readIdPrefix(source);
      for (let seq = 0; seq < 12; seq++, made++) ids.add(`web:${prefix}${seq}`);
    }
  }
  assert.equal(ids.size, made);
  assert.ok(readIdPrefix("r").startsWith("r"));
  assert.notEqual(readIdPrefix("s").slice(1), readIdPrefix("s").slice(1));
});

import test from "node:test";
import assert from "node:assert/strict";
import { STATS_STALE_AFTER, nextFailCount } from "./poll-fails.ts";

test("two failed polls in a row reach the stale threshold", () => {
  const one = nextFailCount(false, 0);
  assert.equal(one < STATS_STALE_AFTER, true);
  assert.equal(nextFailCount(false, one) >= STATS_STALE_AFTER, true);
});

test("a success resets the count", () => {
  assert.equal(nextFailCount(true, 5), 0);
});

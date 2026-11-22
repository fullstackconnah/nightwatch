import test from "node:test";
import assert from "node:assert/strict";
import { BRIEFING_MAX_AGE_MS, BRIEFING_POLL_MS, BRIEFING_SETTLED_MS, briefingRefreshMs, briefingTooOld } from "./briefing-poll.ts";

test("no data polls fast", () => {
  assert.equal(briefingRefreshMs(undefined), BRIEFING_POLL_MS);
  assert.equal(BRIEFING_POLL_MS, 10_000);
});

test("ok without content yet polls fast", () => {
  assert.equal(briefingRefreshMs({ status: "ok" }), BRIEFING_POLL_MS);
});

test("ok with a digest or news settles to 30 minutes, not never", () => {
  assert.equal(briefingRefreshMs({ status: "ok", digest: {} }), BRIEFING_SETTLED_MS);
  assert.equal(briefingRefreshMs({ status: "ok", news: {} }), BRIEFING_SETTLED_MS);
  assert.equal(BRIEFING_SETTLED_MS, 30 * 60_000);
});

test("unavailable and unconfigured settle to 30 minutes", () => {
  assert.equal(briefingRefreshMs({ status: "unavailable" }), BRIEFING_SETTLED_MS);
  assert.equal(briefingRefreshMs({ status: "unconfigured" }), BRIEFING_SETTLED_MS);
});

test("briefingTooOld: null is never old; the limit itself is not old; one ms over is", () => {
  const now = 1_000_000_000;
  assert.equal(briefingTooOld(null, now), false);
  assert.equal(briefingTooOld(now - BRIEFING_MAX_AGE_MS + 1, now), false);
  assert.equal(briefingTooOld(now - BRIEFING_MAX_AGE_MS, now), false);
  assert.equal(briefingTooOld(now - BRIEFING_MAX_AGE_MS - 1, now), true);
  assert.equal(briefingTooOld(now + 5, now), false); // now before the stamp (0 before mount)
  assert.equal(BRIEFING_MAX_AGE_MS, 12 * 60 * 60 * 1000);
});

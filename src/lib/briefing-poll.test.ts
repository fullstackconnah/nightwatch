import test from "node:test";
import assert from "node:assert/strict";
import { BRIEFING_POLL_MS, BRIEFING_SETTLED_MS, briefingRefreshMs } from "./briefing-poll.ts";

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

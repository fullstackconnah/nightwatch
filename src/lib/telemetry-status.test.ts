import test from "node:test";
import assert from "node:assert/strict";
import { effectiveTelemetryStatus as eff, TELEMETRY_STALE_MS } from "./telemetry-status.ts";

test("live with fresh data stays live; silence past the limit reads lost", () => {
  assert.equal(eff("live", 1000, 1000 + TELEMETRY_STALE_MS), "live");
  assert.equal(eff("live", 1000, 1000 + TELEMETRY_STALE_MS + 1), "lost");
});

test("a new sample brings a stale stream back to live", () => {
  assert.equal(eff("live", 50_000, 50_500), "live");
});

test("lost by error stays lost; connecting stays connecting; no data yet is not stale", () => {
  assert.equal(eff("lost", Date.now(), Date.now()), "lost");
  assert.equal(eff("connecting", 0, 1e9), "connecting");
  assert.equal(eff("live", null, 1e9), "live");
});

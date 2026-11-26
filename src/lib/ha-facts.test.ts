import test from "node:test";
import assert from "node:assert/strict";
import { doorbellAgeSec, lockState, nudgedTemp } from "./ha-facts.ts";

test("lockState: unknown and unavailable are not available; known states are", () => {
  assert.deepEqual(lockState("unknown"), { state: "unknown", available: false });
  assert.deepEqual(lockState("unavailable"), { state: "unavailable", available: false });
  assert.deepEqual(lockState("locked"), { state: "locked", available: true });
  assert.deepEqual(lockState("something-new"), { state: "unknown", available: false });
});

const NOW = Date.parse("2026-11-26T00:00:00.000Z");
test("doorbellAgeSec: past is its age, small future skew clamps to 0, a far-future time is no event", () => {
  assert.equal(doorbellAgeSec(NOW - 12_000, NOW), 12);
  assert.equal(doorbellAgeSec(NOW + 5_000, NOW), 0);
  assert.equal(doorbellAgeSec(NOW + 60_000, NOW), 0);
  assert.equal(doorbellAgeSec(NOW + 61_000, NOW), null);
  assert.equal(doorbellAgeSec(NOW + 10 * 60_000, NOW), null);
  assert.equal(doorbellAgeSec(NaN, NOW), null);
});

test("nudgedTemp: the optimistic value rounds to a half degree like the server", () => {
  assert.equal(nudgedTemp(21.3, 0.5), 22);
  assert.equal(nudgedTemp(21, 0.5), 21.5);
  assert.equal(nudgedTemp(21, -0.5), 20.5);
});

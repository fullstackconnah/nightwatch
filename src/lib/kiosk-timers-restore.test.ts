import test from "node:test";
import assert from "node:assert/strict";
import { validTimers } from "./kiosk-timers-restore.ts";

const ok = { id: "a", name: "Tea", durationMs: 1000, endsAt: 5, pausedRemainingMs: null };

test("bad stored entries are dropped, good ones kept", () => {
  assert.deepEqual(validTimers([null]), []);
  assert.deepEqual(validTimers([{ ...ok, endsAt: undefined }]), []);
  assert.deepEqual(validTimers([{ ...ok, durationMs: "1000" }]), []);
  assert.deepEqual(validTimers([{ ...ok, pausedRemainingMs: "x" }]), []);
  assert.deepEqual(validTimers([null, 3, ok, { ...ok, pausedRemainingMs: 400 }]), [ok, { ...ok, pausedRemainingMs: 400 }]);
});

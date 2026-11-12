import test from "node:test";
import assert from "node:assert/strict";
import { doorbellQuiet, QUIET_DAYS } from "./doorbell-quiet.ts";
import type { HaDoorbellSnapshot, HaDoorbellTrigger, HaDoorbellTriggerKind } from "./types/ha.ts";

const NOW = Date.parse("2026-11-12T00:00:00.000Z");
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const trig = (entityId: string, kind: HaDoorbellTriggerKind, firedAt: string | null): HaDoorbellTrigger => ({
  entityId,
  name: entityId,
  kind,
  active: false,
  firedAt,
  ageSec: null,
});
const snap = (triggers: HaDoorbellTrigger[], over: Partial<HaDoorbellSnapshot> = {}): HaDoorbellSnapshot => ({
  status: "ok",
  cameras: [
    { entityId: "camera.front_a", name: "a", available: true },
    { entityId: "camera.front_b", name: "b", available: true },
  ],
  triggers,
  latest: null,
  autoOpen: true,
  viewCamera: null,
  ...over,
});
const BINARIES = [trig("binary_sensor.front_motion", "motion", null), trig("binary_sensor.front_person", "person", null)];

test("(a) the live shape: dead event and activity entities, ding never fired", () => {
  const s = snap([
    trig("event.front_ding", "ding", null),
    trig("event.front_motion", "motion", ago(81.5 * DAY)),
    trig("sensor.front_last_activity", "activity", ago(68.6 * DAY)),
    ...BINARIES,
  ]);
  assert.deepEqual(doorbellQuiet(s, NOW), { days: 68 });
});
test("(b) a motion event 2 h ago is not quiet", () => {
  assert.equal(doorbellQuiet(snap([trig("event.front_motion", "motion", ago(2 * 3_600_000))]), NOW), null);
});
test("(c) ding plus binary sensors only never alerts", () => {
  const s = snap([trig("event.front_ding", "ding", ago(90 * DAY)), trig("binary_sensor.m", "motion", ago(90 * DAY))]);
  assert.equal(doorbellQuiet(s, NOW), null);
});
test("(d) a fresh binary_sensor is ignored: a 10 d old motion event still alerts", () => {
  const s = snap([trig("event.front_motion", "motion", ago(10 * DAY)), trig("binary_sensor.m", "motion", ago(60_000))]);
  assert.deepEqual(doorbellQuiet(s, NOW), { days: 10 });
});
test("(e) every candidate never fired: a hit with no day count", () => {
  const s = snap([trig("event.front_motion", "motion", null), trig("event.front_ding", "ding", ago(60_000)), ...BINARIES]);
  assert.deepEqual(doorbellQuiet(s, NOW), { days: null });
});
test("(f) HA down or no door configured: null", () => {
  const t = [trig("event.front_motion", "motion", ago(80 * DAY))];
  for (const status of ["unreachable", "unconfigured", "unauthorized"] as const) {
    assert.equal(doorbellQuiet(snap(t, { status }), NOW), null, status);
  }
  assert.equal(doorbellQuiet(snap(t, { cameras: [] }), NOW), null);
});
test("(g) the threshold is QUIET_DAYS, to the minute", () => {
  assert.equal(QUIET_DAYS, 3);
  const edge = QUIET_DAYS * DAY;
  assert.equal(doorbellQuiet(snap([trig("event.m", "motion", ago(edge - 60_000))]), NOW), null);
  assert.deepEqual(doorbellQuiet(snap([trig("event.m", "motion", ago(edge + 60_000))]), NOW), { days: 3 });
});

import test from "node:test";
import assert from "node:assert/strict";
import { lastSeenFromHistory } from "./doorbell-last-seen.ts";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const H = 3_600_000;
const at = (ms: number) => new Date(NOW - ms).toISOString();
const IDS = ["binary_sensor.front_door_person", "binary_sensor.front_door_motion"];
const e = (entity_id: string, state: string, last_changed: string) => ({ entity_id, state, last_changed });

test("newest on across several sensors wins", () => {
  const reply = [
    [e(IDS[0], "on", at(5 * H)), e(IDS[0], "off", at(5 * H - 1000))],
    [e(IDS[1], "on", at(2 * H)), e(IDS[1], "off", at(2 * H - 1000))],
  ];
  assert.equal(lastSeenFromHistory(reply, IDS, NOW), at(2 * H));
});
test("only off entries gives null", () => {
  assert.equal(lastSeenFromHistory([[e(IDS[0], "off", at(H))]], IDS, NOW), null);
});
test("an on entry older than 24 h gives null", () => {
  assert.equal(lastSeenFromHistory([[e(IDS[0], "on", at(25 * H))]], IDS, NOW), null);
});
test("malformed or empty reply gives null", () => {
  for (const bad of [null, undefined, "x", {}, [], [null], [[null]], [[{ state: "on" }]], [[e(IDS[0], "on", "garbage")]]]) {
    assert.equal(lastSeenFromHistory(bad, IDS, NOW), null);
  }
});
test("a sensor outside the visitor set is ignored", () => {
  const car = "binary_sensor.front_door_vehicle";
  assert.equal(lastSeenFromHistory([[e(car, "on", at(H))], [e(IDS[0], "on", at(3 * H))]], IDS, NOW), at(3 * H));
  assert.equal(lastSeenFromHistory([[e(car, "on", at(H))]], IDS, NOW), null);
});
test("minimal_response: first entry carries entity_id, later ones only state", () => {
  const reply = [[e(IDS[0], "off", at(9 * H)), { state: "on", last_changed: at(4 * H) }]];
  assert.equal(lastSeenFromHistory(reply, IDS, NOW), at(4 * H));
});

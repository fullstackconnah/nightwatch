import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedSmartHomeFacts, smartHomeFacts } from "./attention-facts.ts";
import { smarthomeModel } from "./page-model.ts";
import { batteryLow, sensorsDown } from "../attention-copy.ts";
import { ownerFor } from "../attention-report.ts";
import type { HaEntities, HaSensor, HaStatesResponse } from "../types/ha.ts";

const sensor = (name: string, over: Partial<HaSensor> = {}): HaSensor => ({
  entityId: `sensor.${name}`, name, kind: "battery", value: 50, unit: "%", available: true, ...over,
});
const ok = (sensors: HaSensor[]): HaStatesResponse => ({
  status: "ok",
  entities: { lights: [], switches: [], climates: [], locks: [], sensors } as unknown as HaEntities,
});

test("a battery at 10 counts, at 11 does not, lowest first", () => {
  const f = smartHomeFacts(ok([sensor("A", { value: 11 }), sensor("B", { value: 10 }), sensor("C", { value: 4 })]));
  assert.deepEqual(f.batteries.map((b) => [b.name, b.value]), [["C", 4], ["B", 10]]);
});

test("a sensor with no battery value, a non-battery sensor and an unavailable battery are never counted as low; the two batteries with no usable reading count as down", () => {
  const f = smartHomeFacts(ok([
    sensor("NoValue", { value: null }),
    sensor("Temp", { kind: "temperature", value: 3 }),
    sensor("Gone", { value: 2, available: false }),
  ]));
  assert.equal(f.batteries.length, 0);
  assert.equal(f.down, 2);
});

test("the not-responding count equals the Smart home page's own count for one fixture", () => {
  const ha = ok([sensor("A", { available: false }), sensor("B", { kind: "humidity", available: false }), sensor("C")]);
  const now = Date.now();
  const strip = JSON.stringify(smarthomeModel({ ha, loadError: false, autoOff: undefined, lockBusy: false, lastOkAt: now, now }));
  assert.equal(smartHomeFacts(ha).down, 2);
  assert.match(strip, /2 not answering/);
});

test("battery copy: one and several forms", () => {
  assert.deepEqual(batteryLow(["Hall"], { name: "Hall", value: 8 }), {
    headline: "Hall battery at 8%", detail: "It will stop reporting when it runs out.", action: "Replace or charge the battery.",
  });
  assert.deepEqual(batteryLow(["Hall", "Shed"], { name: "Hall", value: 8 }), {
    headline: "2 batteries are nearly flat", detail: "The lowest is Hall at 8%.", action: "Replace or charge them.",
  });
});

test("a long sensor name is cut by the house clip", () => {
  const c = batteryLow(["x".repeat(60)], { name: "x".repeat(60), value: 5 });
  assert.equal(c.headline, `${"x".repeat(23)}… battery at 5%`);
  assert.ok(c.headline.length <= 48);
});

test("not-responding copy: one and several forms", () => {
  assert.deepEqual(sensorsDown(1), {
    headline: "A sensor is not responding", detail: "Home Assistant has no reading from it.", action: "Open Smart home to see which one.",
  });
  assert.deepEqual(sensorsDown(3), {
    headline: "3 sensors are not responding", detail: "Home Assistant has no reading from them.", action: "Open Smart home to see which ones.",
  });
});

test("not set up, an error status and a throw give no hits", async () => {
  const none = { batteries: [], down: 0 };
  assert.deepEqual(smartHomeFacts({ status: "unconfigured" } as HaStatesResponse), none);
  assert.deepEqual(smartHomeFacts({ status: "unreachable" } as HaStatesResponse), none);
  const read = cachedSmartHomeFacts(async () => { throw new Error("boom"); }, { key: "test.smarthome.throw" });
  assert.deepEqual(await read(), none);
});

test("the reader holds the snapshot for a minute", async () => {
  let calls = 0;
  const read = cachedSmartHomeFacts(async () => (calls++, ok([sensor("A", { value: 3 })])), { key: "test.smarthome.hold" });
  await read();
  await read();
  assert.equal(calls, 1);
});

test("Smart home hits open the Smart home page", () => {
  assert.deepEqual(ownerFor("smarthome", "battery-low"), { href: "/smarthome", label: "Open Smart home" });
});

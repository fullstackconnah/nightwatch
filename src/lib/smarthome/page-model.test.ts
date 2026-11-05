import test from "node:test";
import assert from "node:assert/strict";
import { statusFor } from "../climate-auto-off.ts";
import { nextOpen } from "../strips.ts";
import type { HaClimate, HaEntities, HaLock, HaStatesResponse } from "../types/ha.ts";
import { acWrites, CONFIRM_WINDOW_MS, lockWrites, smarthomeModel, type Model, type ModelInput, type WriteId } from "./page-model.ts";

const NOW = Date.parse("2026-11-04T10:00:00Z");
const ac = (n: number, o: Partial<HaClimate> = {}): HaClimate => ({
  entityId: `climate.ac${n}`, name: `AC ${n}`, hvacMode: n === 1 ? "cool" : "off", hvacModes: ["off", "cool", "heat"],
  currentTemp: 24, targetTemp: 22, targetTempLow: null, targetTempHigh: null, unit: "C", available: true, ...o,
});
const lock = (state: HaLock["state"] = "locked", o: Partial<HaLock> = {}): HaLock => ({
  entityId: "lock.front", name: "Front door", state, available: state !== "unavailable", ...o,
});
function entities(o: Partial<HaEntities> = {}): HaEntities {
  return {
    lights: [
      { entityId: "light.a", name: "Lamp", on: true, brightnessPct: 60, available: true },
      { entityId: "light.b", name: "Hall light", on: false, brightnessPct: null, available: true },
    ],
    switches: [{ entityId: "switch.a", name: "Fan plug", on: false, available: true }],
    climates: [ac(1), ac(2), ac(3), ac(4)],
    locks: [lock()],
    sensors: [
      { entityId: "sensor.t", name: "Hall temperature", kind: "temperature", value: 22.4, unit: "C", available: true },
      { entityId: "sensor.b", name: "Hall battery", kind: "battery", value: 80, unit: "%", available: true },
    ],
    scenes: [], mediaPlayers: [], ...o,
  };
}
const ok = (e = entities()): HaStatesResponse => ({ status: "ok", entities: e });
const autoOn = { enabled: true, time: "23:00", skipDate: null, lastRunDate: null };
function input(o: Partial<ModelInput> = {}): ModelInput {
  return { ha: ok(), loadError: false, autoOff: autoOn, lockBusy: false, lastOkAt: NOW - 4000, now: NOW, ...o };
}
const w = (m: Model, id: WriteId) => m.writes.find((x) => x.id === id)!;
const enabled = (m: Model) => m.writes.filter((x) => x.enabled).map((x) => x.id).sort();
const strip = (m: Model, id: string) => m.strips.find((s) => s.id === id)!;
const PAUSED = "Controls are paused while the page shows old data.";

test("loading: Checking, nothing writable, no strips, nothing opens", () => {
  const m = smarthomeModel(input({ ha: undefined, lastOkAt: null }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "Checking" });
  assert.equal(m.answer, "Connecting to Home Assistant…");
  assert.deepEqual(m.strips, []);
  assert.deepEqual(enabled(m), []);
  assert.equal(m.autoTarget, "keep");
});

test("load error before any answer: its own copy, nothing writable", () => {
  const m = smarthomeModel(input({ ha: undefined, loadError: true, lastOkAt: null }));
  assert.deepEqual(m.chip, { tone: "warn", label: "No answer" });
  assert.match(m.answer, /can’t reach its own status check/);
  assert.deepEqual(enabled(m), []);
});

test("unconfigured: says what is missing, links to Settings, no strips", () => {
  const m = smarthomeModel(input({ ha: { status: "unconfigured", detail: "no block" } }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "Not connected" });
  assert.equal(m.answer, "Home Assistant isn’t connected yet.");
  assert.deepEqual(m.link, { href: "/settings#integrations", label: "Open Settings" });
  assert.deepEqual(m.strips, []);
  assert.deepEqual(enabled(m), []);
});

test("unreachable: plain copy, the upstream detail (a host) is never on the page", () => {
  const m = smarthomeModel(input({ ha: { status: "unreachable", detail: "ECONNREFUSED 10.0.0.9:8123" } }));
  assert.deepEqual(m.chip, { tone: "warn", label: "Not answering" });
  assert.equal(m.answer, "Home Assistant isn’t answering. Controls are paused until it’s back.");
  assert.doesNotMatch(JSON.stringify(m), /ECONNREFUSED|10\.0\.0\.9|8123/);
  assert.equal(m.evidence, "Retrying every 3 s.");
  assert.deepEqual(m.strips, []);
  assert.deepEqual(enabled(m), []);
  assert.equal(m.autoTarget, null);
});

test("unauthorized: warn, links to Settings, no detail, nothing writable", () => {
  const m = smarthomeModel(input({ ha: { status: "unauthorized", detail: "401 from 192.0.2.5" } }));
  assert.deepEqual(m.chip, { tone: "warn", label: "Token rejected" });
  assert.equal(m.answer, "Home Assistant rejected the access token. Check it in Settings → Integrations.");
  assert.deepEqual(m.link, { href: "/settings#integrations", label: "Open Settings" });
  assert.doesNotMatch(JSON.stringify(m), /192\.0\.2\.5/);
  assert.deepEqual(enabled(m), []);
});

test("connected but no devices: its own answer, no strips", () => {
  const m = smarthomeModel(input({ ha: ok({ ...entities(), lights: [], switches: [], climates: [], locks: [], sensors: [] }) }));
  assert.deepEqual(m.chip, { tone: "ok", label: "Connected" });
  assert.equal(m.answer, "Connected, but Home Assistant shares no devices yet.");
  assert.deepEqual(m.strips, []);
});

test("calm with 1 of 4 ACs on and auto-off: the lead's answer, nothing opens, no problem paint", () => {
  const m = smarthomeModel(input());
  assert.deepEqual(m.chip, { tone: "ok", label: "Connected" });
  assert.equal(m.answer, "Front door locked. 1 of 4 ACs on, turning off at 23:00.");
  assert.equal(m.evidence, "From Home Assistant · updated 4 s ago · checks every 3 s");
  assert.equal(m.notice, null);
  assert.equal(m.autoTarget, null);
  assert.deepEqual(m.order, ["climate", "lock", "lights", "switches", "sensors"]);
  assert.equal(strip(m, "climate").state, "1 of 4 on · auto-off 23:00");
  assert.equal(strip(m, "lock").state, "Front door locked");
  assert.equal(strip(m, "lights").state, "1 of 2 on");
  assert.equal(strip(m, "switches").state, "0 of 1 on");
  assert.equal(strip(m, "sensors").state, "2 readings");
  assert.ok(m.strips.every((s) => s.tone === null));
  assert.deepEqual(enabled(m), ["ac-mode", "ac-nudge", "light-toggle", "switch-toggle", "unlock"]);
  assert.equal(w(m, "lock").reason, "Already locked.");
});

test("auto-off line: dropped when the read failed, is off, no AC is on, or the time is unparseable; skipped says so", () => {
  const climate = (m: Model) => strip(m, "climate").state;
  assert.equal(smarthomeModel(input({ autoOff: undefined })).answer, "Front door locked. 1 of 4 ACs on.");
  assert.equal(climate(smarthomeModel(input({ autoOff: undefined }))), "1 of 4 on");
  assert.equal(smarthomeModel(input({ autoOff: { ...autoOn, enabled: false } })).answer, "Front door locked. 1 of 4 ACs on.");
  assert.equal(climate(smarthomeModel(input({ autoOff: { ...autoOn, enabled: false } }))), "1 of 4 on");
  const noneOn = ok(entities({ climates: [ac(2), ac(3)] }));
  assert.equal(smarthomeModel(input({ ha: noneOn })).answer, "Front door locked. 0 of 2 ACs on.");
  assert.equal(climate(smarthomeModel(input({ ha: noneOn }))), "0 of 2 on");
  assert.equal(smarthomeModel(input({ autoOff: { ...autoOn, time: "bad" } })).answer, "Front door locked. 1 of 4 ACs on.");
  const s = statusFor({ enabled: true, time: "23:00" }, new Date(NOW));
  assert.equal(s.kind, "scheduled");
  const skipDate = s.kind === "scheduled" ? s.window.dateKey : "";
  const sk = smarthomeModel(input({ autoOff: { ...autoOn, skipDate } }));
  assert.equal(sk.answer, "Front door locked. 1 of 4 ACs on, skipped tonight.");
  assert.equal(climate(sk), "1 of 4 on · skipped tonight");
});

test("ac-off: every AC off, the target ± is off, mode still works", () => {
  const m = smarthomeModel(input({ ha: ok(entities({ climates: [ac(2)] })) }));
  assert.equal(m.answer, "Front door locked. The AC is off.");
  assert.equal(w(m, "ac-mode").enabled, true);
  assert.equal(w(m, "ac-nudge").enabled, false);
  assert.equal(w(m, "ac-nudge").reason, "Turn the AC on to change its target.");
});

test("jammed lock: bad chip, the answer names it, Lock opens first and leads its detail", () => {
  const m = smarthomeModel(input({ ha: ok(entities({ locks: [lock("jammed")] })) }));
  assert.deepEqual(m.chip, { tone: "bad", label: "Lock jammed" });
  assert.equal(m.answer, "The front door lock is jammed.");
  assert.equal(m.autoTarget, "lock");
  assert.equal(m.order[0], "lock");
  assert.deepEqual(strip(m, "lock"), { id: "lock", title: "Lock", state: "Front door jammed", tone: "bad" });
  assert.equal(m.detailLead, m.answer);
  assert.equal(w(m, "lock").enabled, true);
  assert.equal(w(m, "unlock").enabled, true);
});

test("a device that stopped answering is named in the answer, partial chip, its strip opens", () => {
  const lamp = { entityId: "light.a", name: "Bedroom lamp", on: false, brightnessPct: null, available: false };
  const m = smarthomeModel(input({ ha: ok(entities({ lights: [lamp] })) }));
  assert.deepEqual(m.chip, { tone: "warn", label: "Partial" });
  assert.equal(m.answer, "Front door locked. 1 of 4 ACs on, turning off at 23:00. Bedroom lamp isn’t answering.");
  assert.equal(m.autoTarget, "lights");
  assert.deepEqual(strip(m, "lights"), { id: "lights", title: "Lights", state: "0 of 1 on · 1 not answering", tone: "warn" });
  const many = ok(entities({ lights: [lamp, { ...lamp, entityId: "l2", name: "Porch" }, { ...lamp, entityId: "l3", name: "Hall" }] }));
  assert.match(smarthomeModel(input({ ha: many })).answer, /Bedroom lamp, Porch and 1 more aren’t answering\.$/);
});

test("an unavailable lock: warn, Lock opens first, both lock writes off", () => {
  const m = smarthomeModel(input({ ha: ok(entities({ locks: [lock("unavailable")] })) }));
  assert.equal(m.autoTarget, "lock");
  assert.equal(m.order[0], "lock");
  assert.equal(strip(m, "lock").state, "Front door isn’t answering");
  assert.equal(strip(m, "lock").tone, "warn");
  assert.equal(w(m, "unlock").enabled, false);
  assert.equal(w(m, "lock").enabled, false);
  assert.equal(w(m, "unlock").reason, "The lock isn’t answering.");
});

test("a low battery is named after the lock and device lines", () => {
  const e = entities();
  e.sensors[1] = { ...e.sensors[1], value: 9 };
  const m = smarthomeModel(input({ ha: ok(e) }));
  assert.match(m.answer, /Hall battery is at 9%\.$/);
  assert.deepEqual(strip(m, "sensors"), { id: "sensors", title: "Sensors", state: "2 readings · Hall battery 9%", tone: "bad" });
});

test("stale (poll failing after a success): neutral chip, old answer, every write off, notice", () => {
  const m = smarthomeModel(input({ loadError: true, lastOkAt: NOW - 3 * 60_000 }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "Stale" });
  assert.equal(m.answer, "Showing what was true 3 min ago: front door locked. 1 of 4 ACs on, turning off at 23:00.");
  assert.equal(m.notice, PAUSED);
  assert.equal(m.autoTarget, "keep");
  assert.deepEqual(enabled(m), []);
  assert.equal(w(m, "unlock").reason, PAUSED);
  assert.equal(acWrites(ac(1), true).mode, false);
  assert.equal(lockWrites(lock(), { stale: true, busy: false }).unlock, false);
  // older than 30 s with no error also counts
  assert.equal(smarthomeModel(input({ lastOkAt: NOW - 31_000 })).chip.label, "Stale");
});

test("lockWrites: Unlock is off when stale, unavailable, locking, unlocking or any lock write is in flight", () => {
  const f = (s: HaLock["state"], o: { stale?: boolean; busy?: boolean; available?: boolean } = {}) =>
    lockWrites(lock(s, { available: o.available ?? s !== "unavailable" }), { stale: o.stale ?? false, busy: o.busy ?? false });
  assert.deepEqual(f("locked"), { lock: false, unlock: true });
  assert.deepEqual(f("unlocked"), { lock: true, unlock: false });
  assert.deepEqual(f("jammed"), { lock: true, unlock: true });
  assert.deepEqual(f("unknown"), { lock: true, unlock: true });
  assert.deepEqual(f("locking"), { lock: false, unlock: false });
  assert.deepEqual(f("unlocking"), { lock: false, unlock: false });
  assert.deepEqual(f("unavailable"), { lock: false, unlock: false });
  assert.deepEqual(f("locked", { available: false }), { lock: false, unlock: false });
  assert.deepEqual(f("locked", { stale: true }), { lock: false, unlock: false });
  assert.deepEqual(f("unlocked", { stale: true }), { lock: false, unlock: false });
  assert.deepEqual(f("locked", { busy: true }), { lock: false, unlock: false });
  assert.deepEqual(f("unlocked", { busy: true }), { lock: false, unlock: false });
});

test("a lock write in flight (page-level busy, or another lock mid-move) turns Unlock off in the group too", () => {
  assert.equal(w(smarthomeModel(input({ lockBusy: true })), "unlock").enabled, false);
  const two = ok(entities({ locks: [lock("locked"), lock("unlocking", { entityId: "lock.back", name: "Back door" })] }));
  const m = smarthomeModel(input({ ha: two }));
  assert.equal(w(m, "unlock").enabled, false);
  assert.equal(w(m, "unlock").reason, "A lock is moving. Wait for it to finish.");
});

test("acWrites: mode needs an available AC; ± also needs it on and a target to move", () => {
  assert.deepEqual(acWrites(ac(1), false), { mode: true, nudge: true });
  assert.deepEqual(acWrites(ac(2), false), { mode: true, nudge: false });
  assert.deepEqual(acWrites(ac(1, { available: false }), false), { mode: false, nudge: false });
  assert.deepEqual(acWrites(ac(1, { targetTemp: null }), false), { mode: true, nudge: false });
  assert.deepEqual(acWrites(ac(1, { targetTemp: null, targetTempLow: 20, targetTempHigh: 24 }), false), { mode: true, nudge: true });
});

test("the confirm window is the old 4 seconds", () => {
  assert.equal(CONFIRM_WINDOW_MS, 4000);
});

test("nextOpen: jammed and unavailable name their strip at both widths; a person's strip is kept", () => {
  const jam = smarthomeModel(input({ ha: ok(entities({ locks: [lock("jammed")] })) })).autoTarget;
  assert.deepEqual(nextOpen({ open: null, by: null }, jam, false), { open: "lock", by: "auto" });
  assert.deepEqual(nextOpen({ open: null, by: null }, jam, true), { open: "lock", by: "auto" });
  const lamp = { entityId: "light.a", name: "Lamp", on: false, brightnessPct: null, available: false };
  const un = smarthomeModel(input({ ha: ok(entities({ lights: [lamp] })) })).autoTarget;
  assert.deepEqual(nextOpen({ open: null, by: null }, un, false), { open: "lights", by: "auto" });
  assert.deepEqual(nextOpen({ open: "sensors", by: "person" }, jam, false), { open: "sensors", by: "person" });
  const calm = smarthomeModel(input()).autoTarget;
  assert.deepEqual(nextOpen({ open: null, by: null }, calm, false), { open: null, by: null });
  assert.deepEqual(nextOpen({ open: null, by: null }, "keep", false), { open: null, by: null });
});

test("a last answer in the future (clock skew) reads 0 s, never a negative age", () => {
  const m = smarthomeModel(input({ lastOkAt: NOW + 5000 }));
  assert.match(m.evidence, /updated 0 s ago/);
});

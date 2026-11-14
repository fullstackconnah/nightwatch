import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGlance, glanceContainers, glanceHome, glanceHomeExtras, glanceMediaExtras } from "./desk-glance.ts";
import { collectCounts } from "./container-counts.ts";
import { pickNowPlaying } from "./now-playing.ts";
import type { HaClimate, HaLight, HaStatesResponse } from "./types/ha.ts";
import type { AttentionReport } from "./attention-report.ts";

const keys = (o: object) => Object.keys(o).sort();
const report = (): AttentionReport => ({
  checkedAt: "2026-01-01T00:00:30.000Z",
  probes: [],
  hits: [],
  changes: { since: "x", status: "answered", events: [], loggedFrom: null },
});
const light = (entityId: string, name: string, on: boolean, available = true): HaLight => ({ entityId, name, on, brightnessPct: null, available });
const climate = (over: Partial<HaClimate> = {}): HaClimate => ({
  entityId: "climate.a",
  name: "Den heat pump",
  hvacMode: "heat",
  hvacModes: ["off", "heat"],
  currentTemp: 21.46,
  targetTemp: 22,
  targetTempLow: null,
  targetTempHigh: null,
  unit: "°C",
  available: true,
  ...over,
});
const states = (lights: HaLight[] = [], climates: HaClimate[] = []): HaStatesResponse =>
  ({ status: "ok", entities: { lights, switches: [], climates, locks: [], sensors: [], scenes: [], mediaPlayers: [] } }) as HaStatesResponse;
const hiddenH = new Set(["light.h"]);
const lights5 = () => [light("light.a", "Hallway lamp", true), light("light.b", "Hallway strip", true), light("light.c", "Porch", true, false), light("light.d", "Study", false), light("light.h", "Secret room", true)];
const counts = async () => ({ total: 7, running: 3, paused: 1, restarting: 1, stopped: 2, unhealthy: 1, dead: 1 });
const never = () => new Promise<never>(() => {});
const hungry = <T>(ms: number, run: () => Promise<T>) => {
  const t0 = Date.now();
  return run().then((v) => ({ v, took: Date.now() - t0 }));
};

test("only kiosk-visible lights are counted", () => {
  const h = glanceHome(states(lights5(), [climate()]), hiddenH)!;
  assert.deepEqual(h.lights, { lightsOn: 2, lightsTotal: 4 });
});

test("a hidden light never leaves", () => {
  const home = glanceHome(states(lights5(), [climate()]), hiddenH);
  const text = JSON.stringify(buildGlance(report(), null, { weather: null, forecast: null, camera: false, home }));
  for (const banned of ["light.h", "Secret room", "light.a", "Hallway lamp", "Hallway strip", "Porch", "Study"]) assert.equal(text.includes(banned), false, banned);
});

test("hidden read rejected or slow: lights null, climate and containers kept", async () => {
  const ha = async () => states(lights5(), [climate()]);
  const a = await glanceHomeExtras(ha, async () => { throw new Error("registry"); }, counts, 300);
  assert.equal(a.home!.lights, null);
  assert.equal(a.home!.climate!.mode, "heat");
  assert.equal(a.containers!.total, 7);
  // slow: the inner race (ms - 100) settles first, so climate survives the outer timer
  const b = await hungry(300, () => glanceHomeExtras(ha, never, counts, 300));
  assert.equal(b.v.home!.lights, null);
  assert.equal(b.v.home!.climate!.mode, "heat");
  assert.equal(b.v.containers!.total, 7);
  assert.ok(b.took < 290, `took ${b.took}`);
});

test("HA never resolves: home null inside the budget, containers kept", async () => {
  const r = await hungry(50, () => glanceHomeExtras(never, async () => new Set<string>(), counts, 50));
  assert.equal(r.v.home, null);
  assert.equal(r.v.containers!.running, 3);
  assert.ok(r.took < 150, `took ${r.took}`);
});

test("docker never resolves: containers null, home kept", async () => {
  const r = await hungry(50, () => glanceHomeExtras(async () => states([], [climate()]), async () => new Set<string>(), never, 50));
  assert.equal(r.v.containers, null);
  assert.equal(r.v.home!.climate!.mode, "heat");
  assert.ok(r.took < 150, `took ${r.took}`);
});

test("one hung HA nulls nowPlaying and home, containers kept", async () => {
  const ha = never;
  const t0 = Date.now();
  const [m, h] = await Promise.all([
    glanceMediaExtras(() => pickNowPlaying(ha, async () => null), async () => ({ status: "failed" }) as never, 50),
    glanceHomeExtras(ha, async () => new Set<string>(), counts, 50),
  ]);
  assert.equal(m.nowPlaying, null);
  assert.equal(h.home, null);
  assert.equal(h.containers!.total, 7);
  assert.ok(Date.now() - t0 < 150);
});

test("a rejecting shared HA call gives null to both, with no unhandled rejection", async () => {
  const seen: unknown[] = [];
  const on = (e: unknown) => seen.push(e);
  process.on("unhandledRejection", on);
  try {
    let p: Promise<HaStatesResponse> | undefined;
    let calls = 0;
    const ha = () => (p ??= (calls++, Promise.reject(new Error("ha down"))));
    const [m, h] = await Promise.all([
      glanceMediaExtras(() => pickNowPlaying(ha, async () => null), async () => ({ status: "failed" }) as never, 200),
      glanceHomeExtras(ha, async () => new Set<string>(), counts, 200),
    ]);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(m.nowPlaying, null);
    assert.equal(h.home, null);
    assert.equal(h.containers!.total, 7);
    assert.equal(calls, 1);
    assert.deepEqual(seen, []);
  } finally {
    process.off("unhandledRejection", on);
  }
});

test("a synchronous throw in any thunk gives null for that field alone", async () => {
  const boom = () => { throw new Error("sync"); };
  const ok = async () => states(lights5(), [climate()]);
  const a = await glanceHomeExtras(boom as never, async () => hiddenH, counts, 200);
  assert.equal(a.home, null);
  assert.equal(a.containers!.total, 7);
  const b = await glanceHomeExtras(ok, boom as never, counts, 200);
  assert.equal(b.home!.lights, null);
  assert.equal(b.home!.climate!.mode, "heat");
  const c = await glanceHomeExtras(ok, async () => hiddenH, boom as never, 200);
  assert.equal(c.containers, null);
  assert.deepEqual(c.home!.lights, { lightsOn: 2, lightsTotal: 4 });
});

test("HA not ok, or no entities, or nothing usable: home null; lights total 0: lights null", () => {
  assert.equal(glanceHome({ status: "unavailable", detail: "x" } as unknown as HaStatesResponse, new Set()), null);
  assert.equal(glanceHome({ status: "ok" } as HaStatesResponse, new Set()), null);
  assert.equal(glanceHome(states([], []), new Set()), null);
  assert.equal(glanceHome(states([light("light.h", "x", true)], []), hiddenH), null);
  const h = glanceHome(states([], [climate()]), new Set())!;
  assert.equal(h.lights, null);
  assert.ok(h.climate);
});

test("climate is the first available one with a known mode", () => {
  const list = [climate({ available: false, name: "Gone" }), climate({ hvacMode: "eco", name: "Odd" }), climate({ name: "Third" })];
  assert.equal(glanceHome(states([], list), new Set())!.climate!.name, "Third");
  assert.equal(glanceHome(states([light("light.a", "x", true)], list.slice(0, 2)), new Set())!.climate, null);
});

test("climate name is cleaned and capped", () => {
  const long = glanceHome(states([], [climate({ name: "Back bedroom\nheat pump upstairs" })]), new Set())!.climate!;
  assert.equal(long.name!.length, 24);
  assert.ok(long.name!.endsWith("…"));
  assert.doesNotMatch(long.name!, /[\0-\x1f\x7f]/);
  const none = glanceHome(states([], [climate({ name: " \n\t " })]), new Set())!.climate!;
  assert.deepEqual(keys(none), ["currentC", "mode", "targetC"]);
});

test("climate temps", () => {
  const t = (over: Partial<HaClimate>) => glanceHome(states([], [climate(over)]), new Set())!.climate!;
  assert.equal(t({ currentTemp: 21.46 }).currentC, 21.5);
  assert.equal(t({ currentTemp: 71.6, unit: "°F" }).currentC, 22);
  for (const bad of [NaN, Infinity, "21", null, 75, -60]) assert.equal(t({ currentTemp: bad as number }).currentC, null, String(bad));
  const dual = t({ hvacMode: "heat_cool", targetTemp: null, targetTempLow: 19, targetTempHigh: 24 });
  assert.equal(dual.targetC, null);
  assert.equal(dual.mode, "heat_cool");
  assert.equal(t({ currentTemp: 21, unit: null }).currentC, 21);
});

test("exact key sets", async () => {
  const h = glanceHome(states(lights5(), [climate()]), hiddenH)!;
  assert.deepEqual(keys(h), ["climate", "lights"]);
  assert.deepEqual(keys(h.lights!), ["lightsOn", "lightsTotal"]);
  assert.deepEqual(keys(h.climate!), ["currentC", "mode", "name", "targetC"]);
  const c = glanceContainers(await collectCounts(async () => [
    { state: "running", health: "healthy" }, { state: "running", health: "unhealthy" }, { state: "running", health: null },
    { state: "paused", health: null }, { state: "restarting", health: null }, { state: "dead", health: null }, { state: "exited", health: null },
  ]));
  assert.deepEqual(keys(c), ["dead", "restarting", "running", "total", "unhealthy"]);
  assert.deepEqual([c.dead, c.restarting, c.running, c.total, c.unhealthy], [1, 1, 3, 7, 1]);
});

test("nothing beyond the allowlist leaves", async () => {
  const x = await glanceHomeExtras(async () => states(lights5(), [climate()]), async () => hiddenH, counts, 200);
  const text = JSON.stringify(buildGlance(report(), null, { weather: null, forecast: null, camera: false, ...x }));
  for (const banned of ["entityId", "light.", "climate.", "switch.", "lock.", "paused", "stopped", "hvacModes", "unit", "available", "brightnessPct"]) {
    assert.equal(text.includes(banned), false, banned);
  }
});

test("buildGlance defaults home and containers to null", () => {
  const g = buildGlance(report(), null);
  assert.equal(g.home, null);
  assert.equal(g.containers, null);
});

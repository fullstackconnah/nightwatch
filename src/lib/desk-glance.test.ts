import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGlance, glanceForecast, glanceWeather, glanceWeatherExtras, within } from "./desk-glance.ts";
import type { WeatherResponse } from "./weather.ts";
import { answerFor } from "./home.ts";
import type { AttentionHit, AttentionReport, ProbeStatus } from "./attention-report.ts";

const ids = ["crashes", "restarts", "smart", "mounts", "backup", "disks", "health", "orchestra"] as const;
const answered = (): ProbeStatus[] => ids.map((id) => ({ id, label: id, state: "answered", hits: 0 }));
const hit = (probe: AttentionHit["probe"], subject: string, over: Partial<AttentionHit> = {}): AttentionHit => ({
  id: `${probe}:${subject}`,
  probe,
  subject,
  severity: "warn",
  headline: "Something is up",
  firstSeen: "2026-01-01T00:00:00.000Z",
  owner: { href: "/resources?metric=disk", label: "Disks in Resources" },
  ...over,
});
const report = (hits: AttentionHit[] = [], probes: ProbeStatus[] = answered()): AttentionReport => ({
  checkedAt: "2026-01-01T00:00:30.000Z",
  probes,
  hits,
  changes: { since: "x", status: "answered", events: [], loggedFrom: null },
});
const vit = {
  cpu: { percent: 12 },
  memory: { total: 1, used: 1, percent: 34 },
  disk: [{ total: 1, used: 1, percent: 50 }, { total: 1, used: 1, percent: 71 }],
  network: { rxPerSec: 0, txPerSec: 0 },
  ts: 1,
};
const keys = (o: object) => Object.keys(o).sort();
const withProbe = (id: string, p: ProbeStatus) => answered().map((x) => (x.id === id ? p : x));

test("orchestra hits go to lanes only, even with a bad disk hit; items keep order", () => {
  const disk = hit("disks", "disk:/a", { severity: "bad" });
  const lane = hit("orchestra", "orchestra", { owner: { href: "/orchestrators", label: "x" } });
  const smart = hit("smart", "drive:sda");
  const g = buildGlance(report([disk, lane, smart]), vit);
  assert.deepEqual(g.lanes.map((i) => i.id), ["orchestra:orchestra"]);
  assert.deepEqual(g.items.map((i) => i.id), [disk.id, smart.id]);
});

test("exact key sets; extra fields on hits do not leak", () => {
  const leaky = { ...hit("disks", "disk:/a", { detail: "d", action: "a", since: "s" }), error: "sock", logs: "secret" } as AttentionHit;
  const g = buildGlance(report([leaky]), vit);
  assert.deepEqual(keys(g), ["answer", "camera", "checkedAt", "downloads", "forecast", "items", "lanes", "nowPlaying", "probes", "tone", "v", "vitals", "weather"]);
  assert.equal(g.nowPlaying, null);
  assert.equal(g.downloads, null);
  assert.equal(g.weather, null);
  assert.equal(g.forecast, null);
  assert.equal(g.camera, false);
  assert.deepEqual(keys(g.items[0]), ["action", "detail", "headline", "href", "id", "severity", "since"]);
  assert.deepEqual(keys(g.probes), ["answered", "failed", "pending"]);
  assert.deepEqual(keys(g.vitals!), ["cpu", "diskMax", "mem"]);
  assert.equal(g.v, 1);
  assert.equal(JSON.stringify(g).includes("secret"), false);
});

test("an item without optional fields has only the required keys", () => {
  const g = buildGlance(report([hit("disks", "disk:/a")]), vit);
  assert.deepEqual(keys(JSON.parse(JSON.stringify(g.items[0]))), ["headline", "href", "id", "severity"]);
});

test("probe counts; a failed probe's error never appears", () => {
  const probes = withProbe("crashes", { id: "crashes", label: "Crashes", state: "failed", error: "/var/run/docker.sock" });
  probes[1] = { id: "restarts", label: "Restarts", state: "pending" };
  const g = buildGlance(report([], probes), vit);
  assert.deepEqual(g.probes, { answered: 6, failed: 1, pending: 1 });
  assert.equal(JSON.stringify(g).includes("docker.sock"), false);
});

test("hrefs: the #backup anchor becomes /#backup; paths stay", () => {
  const g = buildGlance(
    report([hit("backup", "backup", { owner: { href: "#backup", label: "Backup detail" } }), hit("disks", "disk:/a")]),
    vit,
  );
  assert.deepEqual(g.items.map((i) => i.href), ["/#backup", "/resources?metric=disk"]);
});

test("hrefs: anything but a lowercase #anchor or a path falls back to /", () => {
  for (const href of ["", "#", "#a b", '#x"y', "#Backup", "http://x.example", "javascript:alert(1)"]) {
    const g = buildGlance(report([hit("backup", "backup", { owner: { href, label: "x" } })]), vit);
    assert.equal(g.items[0].href, "/", JSON.stringify(href));
  }
});

test("tone and answer come from answerFor", () => {
  const cases: AttentionReport[] = [
    report(),
    report([], withProbe("crashes", { id: "crashes", label: "Crashes", state: "failed", error: "x" })),
    report([], withProbe("smart", { id: "smart", label: "SMART", state: "pending" })),
    report([hit("disks", "disk:/a"), hit("smart", "drive:sda"), hit("mounts", "mount:/m")]),
  ];
  for (const r of cases) {
    const want = answerFor({ report: r, error: false, running: null, backupAgo: null });
    const g = buildGlance(r, vit);
    assert.equal(g.tone, want.tone);
    assert.equal(g.answer, want.text);
  }
});

test("checkedAt is the report's", () => assert.equal(buildGlance(report(), vit).checkedAt, "2026-01-01T00:00:30.000Z"));

test("vitals: worst disk; empty disk list gives null diskMax; missing vitals give null", () => {
  assert.deepEqual(buildGlance(report(), vit).vitals, { cpu: 12, mem: 34, diskMax: 71 });
  assert.equal(buildGlance(report(), { ...vit, disk: [] }).vitals!.diskMax, null);
  assert.equal(buildGlance(report(), null).vitals, null);
});

test("hit ids stay the same when only the headline numbers change", () => {
  const a = buildGlance(report([hit("disks", "disk:/a", { headline: "Disk 91% full" })]), vit);
  const b = buildGlance(report([hit("disks", "disk:/a", { headline: "Disk 93% full" })]), vit);
  assert.equal(a.items[0].id, b.items[0].id);
});

const wx = (over: object = {}) =>
  ({
    status: "ok",
    place: "Somewhere",
    current: { tempC: 21.4, feelsC: 19.9, humidityPct: 50, windKmh: 12, precipMm: 0, cloudCoverPct: 10, code: "clear", label: "Clear" },
    days: [{ date: "2026-01-01", code: "rain", label: "Rain", maxC: 25, minC: 14, rainPct: 60, sunrise: "x", sunset: "y" }],
    sun: { elevationDeg: 1, phase: "day", progress01: 0.5, hourAngleDeg: 0 },
    rain: { nowcast: [], hours: [], summary: "rain soon" },
    lat: -33.1,
    lon: 151.2,
    ...over,
  }) as unknown as WeatherResponse;

test("weather is an allowlist: no lat, lon, humidity, wind, place or sun", () => {
  const w = glanceWeather(wx());
  assert.deepEqual(w, { tempC: 21.4, feelsC: 19.9, label: "Clear", highC: 25, lowC: 14, rainPct: 60, icon: "clear" });
  const text = JSON.stringify(buildGlance(report(), vit, { weather: w, forecast: null, camera: true }));
  for (const banned of ["lat", "lon", "humidity", "wind", "Somewhere", "sun"]) assert.equal(text.includes(banned), false, banned);
});

test("weather is null when unconfigured or unreachable, and tolerates no forecast day", () => {
  assert.equal(glanceWeather({ status: "unconfigured", detail: "x" }), null);
  assert.equal(glanceWeather({ status: "unreachable", detail: "x" }), null);
  assert.deepEqual(glanceWeather(wx({ days: [] })), { tempC: 21.4, feelsC: 19.9, label: "Clear", highC: null, lowC: null, rainPct: null, icon: "clear" });
});

test("within: a never-resolving promise, a rejection and a value", { timeout: 5000 }, async () => {
  const t0 = Date.now();
  assert.equal(await within(new Promise<string>(() => {}), 50, "fallback"), "fallback");
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(await within(Promise.reject(new Error("x")), 50, null), null);
  assert.equal(await within(Promise.resolve(7), 50, 0), 7);
});

test("the new output's keys are a strict superset of the legacy fixture's, and vitals/probes keep their shape", () => {
  const legacy = JSON.parse(readFileSync(new URL("../../desk/Core.Tests/fixtures/glance.v1-legacy.json", import.meta.url), "utf8"));
  const now = JSON.parse(JSON.stringify(buildGlance(report(), vit)));
  for (const k of Object.keys(legacy)) assert.ok(k in now, k);
  assert.deepEqual(Object.keys(now).filter((k) => !(k in legacy)).sort(), ["camera", "downloads", "forecast", "nowPlaying", "weather"]);
});

const day = (date: string, over: object = {}) => ({ date, code: "rain", label: "Rain", maxC: 25, minC: 14, rainPct: 60, sunrise: "x", sunset: "y", ...over });
const days6 = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"].map((d) => day(d));

test("forecast caps at 4 days from days[1..4]", () => {
  const f = glanceForecast(wx({ days: days6 }))!;
  assert.equal(f.length, 4);
  assert.deepEqual(f.map((d) => d.day), days6.slice(1, 5).map((d) => d.date));
});

test("forecast passes null highs, lows and rain through as null", () => {
  const f = glanceForecast(wx({ days: [day("2026-01-01"), day("2026-01-02", { code: "snow", maxC: null, minC: null, rainPct: null })] }))!;
  assert.deepEqual(f[0], { day: "2026-01-02", icon: "snow", highC: null, lowC: null, rainPct: null });
});

test("forecast is null when weather is unconfigured or unreachable, and empty with only today", () => {
  assert.equal(glanceForecast({ status: "unconfigured", detail: "x" }), null);
  assert.equal(glanceForecast({ status: "unreachable", detail: "x" }), null);
  assert.deepEqual(glanceForecast(wx()), []);
});

test("forecast day has the exact key set and leaks nothing else", () => {
  const f = glanceForecast(wx({ days: [day("2026-01-01"), day("2026-01-02", { junk: "leak-me", label: "Secret label" })] }))!;
  assert.deepEqual(keys(f[0]), ["day", "highC", "icon", "lowC", "rainPct"]);
  const text = JSON.stringify(f);
  for (const banned of ["sunrise", "sunset", "leak-me", "Secret label"]) assert.equal(text.includes(banned), false, banned);
});

test("glanceWeatherExtras calls weather once and fills both fields", { timeout: 5000 }, async () => {
  let calls = 0;
  const r = await glanceWeatherExtras(async () => (calls++, wx({ days: days6 })), 50);
  assert.equal(calls, 1);
  assert.equal(r.weather?.label, "Clear");
  assert.equal(r.forecast?.length, 4);
  assert.deepEqual(await glanceWeatherExtras(() => new Promise<WeatherResponse>(() => {}), 50), { weather: null, forecast: null });
  assert.deepEqual(await glanceWeatherExtras(() => Promise.reject(new Error("x")), 50), { weather: null, forecast: null });
});

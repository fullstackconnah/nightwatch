import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { getWeather, setWeatherClock, type WeatherOk } from "./weather.ts";

// Invented coordinates and place; the config lives in a throwaway DATA_DIR.
const realFetch = globalThis.fetch;
let dir = "";
let tick = 0;

interface Stub {
  daily?: Record<string, unknown>;
  nowIso?: string;
  forecastStatus?: number;
  air?: unknown;
  airThrows?: boolean;
  airCalls: number;
  forecastCalls: number;
}
let stub: Stub;

function daily(over: Record<string, unknown> = {}) {
  const time = ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"];
  return {
    time,
    weather_code: [1, 1, 1, 1, 1],
    temperature_2m_max: [20, 20, 20, 20, 20],
    temperature_2m_min: [10, 10, 10, 10, 10],
    precipitation_probability_max: [0, 0, 0, 0, 0],
    sunrise: time.map((d) => `${d}T05:56`),
    sunset: time.map((d) => `${d}T19:33`),
    uv_index_max: [7.4, 9.6, 5, 5, 5],
    ...over,
  };
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-uv-air-"));
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ display: { lat: -30, lon: 150, place: "Testville", timezone: "Australia/Sydney" } }));
  process.env.DATA_DIR = dir;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.startsWith("https://air-quality-api.open-meteo.com/")) {
      stub.airCalls++;
      if (stub.airThrows) throw new Error("air down");
      return new Response(JSON.stringify(stub.air ?? { current: { european_aqi: 27 } }));
    }
    stub.forecastCalls++;
    if (stub.forecastStatus && stub.forecastStatus !== 200) return new Response("nope", { status: stub.forecastStatus });
    return new Response(JSON.stringify({ current: { time: stub.nowIso ?? "2026-11-15T10:00", temperature_2m: 18 }, daily: stub.daily ?? daily(), minutely_15: {}, hourly: {} }));
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  stub = { airCalls: 0, forecastCalls: 0 };
  tick += 3_600_000; // an hour on: both caches expire, so every test fetches fresh
  setWeatherClock(() => tick);
});

async function ok(): Promise<WeatherOk> {
  const w = await getWeather();
  assert.equal(w.status, "ok");
  return w as WeatherOk;
}

describe("kiosk uv and air: server (T1-T7)", () => {
  it("T1: day switches to tomorrow at sunset and reads that day's peak", async () => {
    stub.nowIso = "2026-11-15T10:00";
    assert.deepEqual({ day: (await ok()).uv?.day, peak: (await ok()).uv?.peak }, { day: "today", peak: 7 });
    tick += 3_600_000;
    stub.nowIso = "2026-11-15T19:40";
    const w = await ok();
    assert.equal(w.uv?.day, "tomorrow");
    assert.equal(w.uv?.peak, 10);
  });

  it("T2: peakAt is the sunrise/sunset midpoint rounded to 15 min, null without sunset", async () => {
    stub.daily = daily({ sunrise: ["2026-11-15T06:10", "x", "x", "x", "x"], sunset: ["2026-11-15T19:50", "x", "x", "x", "x"] });
    assert.equal((await ok()).uv?.peakAt, "1:00 pm");
    tick += 3_600_000;
    stub.daily = daily({ sunrise: ["2026-11-15T05:56", "x", "x", "x", "x"], sunset: [null, null, null, null, null] });
    assert.equal((await ok()).uv?.peakAt, null);
    tick += 3_600_000;
    stub.daily = daily({ sunrise: ["2026-11-15T06:00", "x", "x", "x", "x"], sunset: ["2026-11-15T19:00", "x", "x", "x", "x"] });
    assert.equal((await ok()).uv?.peakAt, "12:30 pm");
  });

  it("T3: an unusable uv value gives uv null; 11.6 rounds to 12", async () => {
    for (const bad of [null, "x", -1, 30]) {
      tick += 3_600_000;
      stub.daily = daily({ uv_index_max: [bad, 5, 5, 5, 5] });
      assert.equal((await ok()).uv, null, `uv ${String(bad)}`);
    }
    tick += 3_600_000;
    stub.daily = daily({ uv_index_max: [11.6, 5, 5, 5, 5] });
    assert.equal((await ok()).uv?.peak, 12);
  });

  it("T3b: a payload with no uv_index_max at all gives uv null", async () => {
    const d = daily();
    delete (d as Record<string, unknown>).uv_index_max;
    stub.daily = d;
    assert.equal((await ok()).uv, null);
  });

  it("T4: air index rounds; a missing, non-numeric or negative value gives null", async () => {
    stub.air = { current: { european_aqi: 18.4 } };
    assert.deepEqual((await ok()).air, { index: 18 });
    for (const bad of [{ current: {} }, { current: { european_aqi: "x" } }, { current: { european_aqi: -3 } }, {}]) {
      tick += 3_600_000;
      stub.air = bad;
      assert.equal((await ok()).air, null, JSON.stringify(bad));
    }
  });

  it("T5: a failed air call leaves the forecast whole", async () => {
    stub.airThrows = true;
    const w = await ok();
    assert.equal(w.days.length, 5);
    assert.equal(w.air, null);
    assert.equal(w.uv?.peak, 7);
  });

  it("T6: a failed air call is not retried inside 30 s, and is retried after", async () => {
    stub.airThrows = true;
    await ok();
    assert.equal(stub.airCalls, 1);
    tick += 10_000;
    await ok();
    assert.equal(stub.airCalls, 1);
    tick += 25_000;
    stub.airThrows = false;
    const w = await ok();
    assert.equal(stub.airCalls, 2);
    assert.deepEqual(w.air, { index: 27 });
  });

  it("T7: a forecast HTTP 500 is unreachable whatever the air call did", async () => {
    stub.forecastStatus = 500;
    const w = await getWeather();
    assert.equal(w.status, "unreachable");
    assert.ok(!("air" in w));
  });
});

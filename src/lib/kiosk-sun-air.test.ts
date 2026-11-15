import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { airBand, sunAirView, uvBand, type SunAirSource } from "./kiosk-sun-air.ts";
import { applyWxPreview } from "./kiosk-weather-fx.ts";

const at = (h: number, m = 0) => new Date(2026, 10, 15, h, m);
const DAYS = [{ sunset: "2026-11-15T19:42" }];
const src = (uv: SunAirSource["uv"], air: SunAirSource["air"]): SunAirSource => ({ uv, air, days: DAYS });
const today = (peak: number, peakAt: string | null = "12:30 pm") => ({ day: "today" as const, peak, peakAt });
const tomorrow = (peak: number, peakAt: string | null = "12:30 pm") => ({ day: "tomorrow" as const, peak, peakAt });

describe("kiosk sun and air: bands (T8, T9)", () => {
  it("T8: UV band edges and tone", () => {
    const rows: Array<[number, string, string]> = [
      [0, "Low", "none"], [2, "Low", "none"], [3, "Moderate", "warn"], [5, "Moderate", "warn"], [6, "High", "warn"],
      [7, "High", "warn"], [8, "Very high", "bad"], [10, "Very high", "bad"], [11, "Extreme", "bad"], [14, "Extreme", "bad"],
    ];
    for (const [n, word, tone] of rows) assert.deepEqual(uvBand(n), { word, tone }, `uv ${n}`);
  });

  it("T9: air band edges and tone", () => {
    const rows: Array<[number, string, string]> = [
      [0, "Good", "none"], [19, "Good", "none"], [20, "Fair", "none"], [39, "Fair", "none"], [40, "Moderate", "warn"],
      [59, "Moderate", "warn"], [60, "Poor", "bad"], [79, "Poor", "bad"], [80, "Very poor", "bad"], [100, "Very poor", "bad"],
      [101, "Extremely poor", "bad"],
    ];
    for (const [n, word, tone] of rows) assert.deepEqual(airBand(n), { word, tone }, `air ${n}`);
  });
});

describe("kiosk sun and air: copy (T10, T13, T14)", () => {
  it("T10: UV 2 with air Poor", () => {
    const v = sunAirView(src(today(2), { index: 74 }), at(11));
    assert.deepEqual(v?.glance?.uv, { caption: "UV today", figure: "2", word: "Low", sub: "No hats needed", tone: "none" });
    assert.deepEqual(v?.glance?.air, { caption: "Air quality", word: "Poor", sub: "Index 74", tone: "bad" });
  });

  it("T10: UV 9 before the peak, at the peak, and tomorrow", () => {
    const before = sunAirView(src(today(9), { index: 31 }), at(11))?.glance?.uv;
    assert.equal(before?.caption, "UV today · peak 12:30 pm");
    assert.equal(before?.sub, "Hats and sunscreen");
    assert.equal(before?.tone, "bad");
    assert.equal(sunAirView(src(today(9), { index: 31 }), at(12, 30))?.glance?.uv?.caption, "UV today · peaked 12:30 pm");
    assert.equal(sunAirView(src(today(9), { index: 31 }), at(15))?.glance?.uv?.sub, "Hats and sunscreen");
    const t = sunAirView(src(tomorrow(9), { index: 31 }), at(21))?.glance?.uv;
    assert.equal(t?.caption, "UV tomorrow · peak 12:30 pm");
    assert.equal(t?.word, "Very high tomorrow");
    assert.equal(t?.sub, "Pack hats and sunscreen");
  });

  it("T10: UV 3+ without a peak time has a bare caption; low UV never shows a peak", () => {
    assert.equal(sunAirView(src(today(7, null), { index: 31 }), at(11))?.glance?.uv?.caption, "UV today");
    assert.equal(sunAirView(src(today(2), { index: 74 }), at(11))?.glance?.uv?.caption, "UV today");
  });

  it("T13: peak versus peaked, past only after the peak and sunset on a today payload", () => {
    const air = { index: 31 };
    assert.equal(sunAirView(src(today(12), air), at(12, 29))?.glance?.uv?.caption, "UV today · peak 12:30 pm");
    assert.equal(sunAirView(src(today(12), air), at(12, 30))?.glance?.uv?.caption, "UV today · peaked 12:30 pm");
    const evening = sunAirView(src(today(12), air), at(18, 30));
    assert.equal(evening?.glance?.uv?.tone, "bad");
    assert.equal(evening?.glance?.uv?.sub, "Hats and sunscreen");
    assert.equal(evening?.inline.uv?.text, "UV 12 Extreme");
    const past = sunAirView(src(today(12), air), at(19, 50));
    assert.deepEqual(past?.glance?.uv, { caption: "UV today · peaked 12:30 pm", figure: "12", word: "Extreme", sub: "Peaked 12:30 pm", tone: "none" });
    assert.equal(past?.inline.uv?.text, "UV peaked 12 Extreme");
    assert.equal(past?.inline.uv?.tone, "none");
    assert.ok(!/hats/i.test(past?.sr ?? ""));
    const tmrw = sunAirView(src(tomorrow(12), air), at(19, 50));
    assert.equal(tmrw?.glance?.uv?.caption, "UV tomorrow · peak 12:30 pm");
    assert.equal(tmrw?.glance?.uv?.tone, "bad");
    assert.equal(tmrw?.inline.uv?.text, "UV 12 Extreme tomorrow");
  });

  it("T13: with no sunset in the payload the past rule never fires", () => {
    const v = sunAirView({ uv: today(12), air: { index: 31 }, days: [{}] }, at(23));
    assert.equal(v?.glance?.uv?.sub, "Hats and sunscreen");
  });

  it("T14: the cue", () => {
    assert.equal(sunAirView(src(today(3), null), at(9))?.glance?.uv?.sub, "Hats and sunscreen");
    assert.equal(sunAirView(src(tomorrow(3), null), at(21))?.glance?.uv?.sub, "Pack hats and sunscreen");
    assert.equal(sunAirView(src(tomorrow(2), { index: 74 }), at(21))?.glance?.uv?.sub, "No hats needed");
  });

  it("the screen-reader sentence carries everything", () => {
    assert.equal(
      sunAirView(src(today(12), { index: 31 }), at(15))?.sr,
      "UV today 12, extreme. Peaked 12:30 pm. Hats and sunscreen. Air quality fair, index 31.",
    );
  });
});

describe("kiosk sun and air: missing halves and drop (T11, T12, T15)", () => {
  it("T11: air null with UV 9 has no air half", () => {
    const v = sunAirView(src(today(9, "1:00 pm"), null), at(9));
    assert.equal(v?.glance?.air, null);
    assert.equal(v?.glance?.uv?.caption, "UV today · peak 1:00 pm");
    assert.equal(v?.inline.air, null);
    assert.equal(v?.inline.uv?.text, "UV 9 Very high");
    assert.ok(!/no reading/i.test(JSON.stringify(v)));
  });

  it("T11: UV null with air Moderate gives an air-only pane", () => {
    const v = sunAirView(src(null, { index: 52 }), at(9));
    assert.equal(v?.glance?.uv, null);
    assert.deepEqual(v?.glance?.air, { caption: "Air quality", word: "Moderate", sub: "Index 52", tone: "warn" });
    assert.equal(v?.inline.uv, null);
    assert.equal(v?.inline.air?.text, "Air moderate");
  });

  it("T11: UV null with air Good drops the pane and keeps the inline", () => {
    const v = sunAirView(src(null, { index: 12 }), at(9));
    assert.ok(v);
    assert.equal(v.glance, null);
    assert.equal(v.inline.air?.text, "Air good");
  });

  it("T11: both null, or no ok, gives null", () => {
    assert.equal(sunAirView(src(null, null), at(9)), null);
    assert.equal(sunAirView(null, at(9)), null);
    assert.equal(sunAirView(undefined, at(9)), null);
  });

  it("T12: an ok object with no uv or air keys gives null and does not throw", () => {
    assert.equal(sunAirView({ days: DAYS }, at(9)), null);
    assert.equal(sunAirView({}, at(9)), null);
  });

  it("the pane drops on a quiet day and rises for UV 3, or air Moderate", () => {
    assert.equal(sunAirView(src(today(2), { index: 31 }), at(11))?.glance, null);
    assert.ok(sunAirView(src(today(3), { index: 12 }), at(11))?.glance);
    assert.ok(sunAirView(src(today(2), { index: 40 }), at(11))?.glance);
    assert.equal(sunAirView(src(today(2), { index: 39 }), at(11))?.glance, null);
  });

  it("T15: the inline omits air when quiet and shows it when UV is missing or UV is 3+", () => {
    assert.deepEqual(sunAirView(src(today(2), { index: 12 }), at(11))?.inline, { uv: { label: "UV", value: "2 Low", text: "UV 2 Low", tone: "none" }, air: null });
    assert.equal(sunAirView(src(today(6), { index: 12 }), at(11))?.inline.air?.text, "Air good");
    assert.equal(sunAirView(src(today(2), { index: 74 }), at(11))?.inline.air?.text, "Air poor");
    assert.equal(sunAirView(src(null, { index: 12 }), at(11))?.inline.air?.text, "Air good");
    const worst = sunAirView(src(tomorrow(10), { index: 140 }), at(21))?.inline;
    assert.equal(worst?.uv?.text, "UV 10 Very high tomorrow");
    assert.equal(worst?.air?.text, "Air extremely poor");
    assert.deepEqual(sunAirView(src(today(6), { index: 31 }), at(11))?.inline.air, { label: "Air", value: "Fair", text: "Air fair", tone: "none" });
  });
});

describe("applyWxPreview keeps the UV and air fields", () => {
  it("a ?wx= preview carries uv and air from the real payload", () => {
    const real = { status: "ok" as const, uv: today(9), air: { index: 31 } };
    const out = applyWxPreview(real, "overcast", null) as unknown as SunAirSource;
    assert.deepEqual(out.uv, today(9));
    assert.deepEqual(out.air, { index: 31 });
  });
});

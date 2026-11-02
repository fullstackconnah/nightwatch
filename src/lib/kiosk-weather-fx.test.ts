import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FLASH_PEAK_ALPHA,
  WX_PRESETS,
  applyWxPreview,
  effectiveMmHr,
  flashEnvelope,
  flashPeakDeltaL,
  leanAt,
  PULSE2_OFFSET_MS,
  rainBand,
  stepStrikes,
  rainParams,
  sampleStreak,
  type RainBand,
  type WetBand,
} from "./kiosk-weather-fx.ts";
import { SUNROOM_STOPS, sunroomStateAt } from "./sunroom-light.ts";

/** Small seeded PRNG so the sampled tests are reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BANDS: WetBand[] = ["drizzle", "light", "moderate", "heavy"];

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Alpha blend in sRGB space, which is what the framebuffer does. */
const over = (ground: number[], hex: string, a: number) => {
  const c = rgb(hex);
  return ground.map((g, i) => g * (1 - a) + c[i] * a);
};

const GLOW = "#ecf2fc";
const STREAK = { dark: "#ecf2fc", light: "#283448" };
// Droplets are the loudest thing on the glass, so they set the worst overlay.
const WORST_ALPHA = { dark: 0.16, light: 0.12 };

/** Every ground the sunroom can show: the six stops, then a sweep of the
 *  weathered ramp at full cloud and full rain. Mid-crossing states are skipped
 *  because no ink clears AA there at all (sunroomStateAt documents the band). */
function grounds() {
  const out: Array<{ name: string; bg: string; ink: string; dark: boolean }> = [];
  SUNROOM_STOPS.forEach((s, i) => {
    out.push({ name: s.name, bg: s.palette.bg, ink: s.palette.ink, dark: !!s.dark });
    for (const k of [0, 0.5]) {
      const st = sunroomStateAt(i + k, { cloud01: 1, rain01: 1 });
      if (!st.crossing) out.push({ name: `${s.name}+${k}/wet`, bg: st.palette.bg, ink: st.palette.ink, dark: st.isDark });
    }
  });
  return out;
}

describe("rainBand", () => {
  it("maps rates and the condition-code floor", () => {
    assert.equal(rainBand(0, "clear"), "none");
    assert.equal(rainBand(0.3, "clear"), "drizzle");
    assert.equal(rainBand(1.2, "clear"), "light");
    assert.equal(rainBand(4, "clear"), "moderate");
    assert.equal(rainBand(12, "clear"), "heavy");
    assert.equal(rainBand(0, "rain"), "light");
    assert.equal(rainBand(0, "showers"), "light");
    assert.equal(rainBand(0, "thunderstorm"), "moderate");
    assert.equal(rainBand(0, "drizzle"), "drizzle");
    assert.equal(rainBand(0, "snow"), "none");
    assert.equal(rainBand(1.2, "snow"), "none");
    assert.equal(rainBand(12, "snow"), "none");
    assert.equal(rainBand(NaN, "clear"), "none");
  });
  it("never lowers a band the rate already earned", () => {
    assert.equal(rainBand(12, "drizzle"), "heavy");
    assert.equal(rainBand(4, "rain"), "moderate");
  });
});

describe("rainParams", () => {
  it("counts per band at the reference size, capped at 400", () => {
    const counts = BANDS.map((b) => rainParams(b, 0, 1180, 820).count);
    assert.deepEqual(counts, [70, 140, 240, 380]);
    for (const b of BANDS) assert.equal(rainParams(b, 0, 2732, 2048).count <= 400, true);
    assert.equal(rainParams("heavy", 0, 2732, 2048).count, 400);
  });
  it("base length covers one frame step", () => {
    for (const b of BANDS) {
      const p = rainParams(b, 0, 1180, 820);
      assert.ok(p.lengthNear >= p.speedNear / 30);
    }
  });
  it("every sampled streak is at least one 30fps step long, after jitter", () => {
    const rng = mulberry32(7);
    for (const b of BANDS) {
      const p = rainParams(b, 20, 1180, 820);
      for (let i = 0; i < 1000; i++) {
        const s = sampleStreak(p, b, rng);
        assert.ok(s.length >= s.speed / 30, `${b}: len ${s.length} < speed/30 ${s.speed / 30}`);
      }
    }
  });
  it("drizzle has only far and mid streaks, half each", () => {
    const rng = mulberry32(3);
    const p = rainParams("drizzle", 0, 1180, 820);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(sampleStreak(p, "drizzle", rng).depth);
    assert.deepEqual([...seen].sort(), ["far", "mid"]);
  });
  it("drizzle's row is the mid band and far is that row x the far factors", () => {
    const rng = mulberry32(5);
    const p = rainParams("drizzle", 0, 1180, 820);
    for (let i = 0; i < 400; i++) {
      const s = sampleStreak(p, "drizzle", rng);
      const base = s.depth === "mid" ? 420 : 420 * 0.55;
      assert.ok(s.speed >= base * 0.85 - 1e-9 && s.speed <= base * 1.15 + 1e-9, `${s.depth} speed ${s.speed}`);
      assert.equal(s.aMult, s.depth === "mid" ? 1 : 0.45);
      assert.equal(s.width, 1);
    }
  });
});

describe("lean", () => {
  it("scales with wind and caps at 25 degrees", () => {
    assert.equal(rainParams("light", 0, 1180, 820).leanDeg, 0);
    assert.equal(rainParams("light", 50, 1180, 820).leanDeg, 25);
    assert.equal(rainParams("light", 120, 1180, 820).leanDeg, 25);
  });
  it("lean plus wobble never exceeds 29 degrees, at any time", () => {
    const p = rainParams("heavy", 120, 1180, 820);
    assert.ok(p.leanDeg + p.wobbleDeg <= 29);
    for (let t = 0; t < 120; t += 0.37) assert.ok(leanAt(p, t) <= 29 && leanAt(p, t) >= 21);
  });
});

/** Drives the renderer's strike scheduler at 30 fps, toggling the storm off for
 *  a while mid-run, and returns every strike it started. */
function runStrikes(seed: number, durationMs: number, firstAt?: number) {
  const rng = mulberry32(seed);
  const clock = { nextAt: Infinity, firstUsed: false };
  const out: Array<{ at: number; hold: number; double: boolean }> = [];
  for (let now = 0; now < durationMs; now += 33) {
    const storm = !(now > 100_000 && now < 130_000);
    const s = stepStrikes(clock, now, storm, rng, firstAt);
    if (s) out.push(s);
  }
  return out;
}
describe("lightning", () => {
  it("keeps strikes 8s apart and at most 2 pulses in any second", () => {
    for (const firstAt of [undefined, 1500]) {
      const strikes = runStrikes(42, 600_000, firstAt);
      assert.ok(strikes.length > 10);
      for (let i = 1; i < strikes.length; i++) assert.ok(strikes[i].at - strikes[i - 1].at >= 8000);
      const starts = strikes.flatMap((s) => (s.double ? [s.at, s.at + PULSE2_OFFSET_MS] : [s.at]));
      for (const t of starts) assert.ok(starts.filter((u) => u >= t && u < t + 1000).length <= 2);
    }
  });
  it("fires the preview's first strike once, at its time, as a single long pulse", () => {
    const strikes = runStrikes(1, 600_000, 1500);
    assert.ok(strikes[0].at >= 1500 && strikes[0].at < 1500 + 33);
    assert.deepEqual([strikes[0].hold, strikes[0].double], [500, false]);
    assert.equal(strikes.filter((s) => s.hold === 500).length, 1);
    assert.ok(strikes.slice(1).every((s) => s.hold === 60));
  });
  it("starts nothing while the storm is off", () => {
    const clock = { nextAt: Infinity, firstUsed: false };
    for (let now = 0; now < 60_000; now += 33) assert.equal(stepStrikes(clock, now, false, mulberry32(3), 0), null);
    assert.equal(clock.nextAt, Infinity);
  });
  it("envelope stays in 0..1 and ends", () => {
    for (const opts of [{}, { double: true }, { hold: 500 }]) {
      for (let t = 0; t < 3000; t += 10) {
        const v = flashEnvelope(t, opts);
        assert.ok(v >= 0 && v <= 1);
      }
      assert.equal(flashEnvelope(3000, opts), 0);
    }
    assert.equal(flashEnvelope(400, { hold: 500 }), 1);
  });
});

describe("photosensitivity and contrast", () => {
  it("peak flash luminance change is at most 0.05 on every ground", () => {
    for (const g of grounds()) {
      const a = g.dark ? FLASH_PEAK_ALPHA.dark : FLASH_PEAK_ALPHA.light;
      const d = flashPeakDeltaL(g.bg, a);
      assert.ok(d <= 0.05, `${g.name}: dL ${d.toFixed(4)}`);
    }
  });
  it("ink keeps 4.5:1 under flash glow plus the loudest streak or droplet", () => {
    let checked = 0;
    let worst = Infinity;
    for (const g of grounds()) {
      const mode = g.dark ? "dark" : "light";
      const base = contrast(rgb(g.ink), rgb(g.bg));
      let px = over(rgb(g.bg), GLOW, FLASH_PEAK_ALPHA[mode]);
      px = over(px, STREAK[mode], WORST_ALPHA[mode]);
      const c = contrast(rgb(g.ink), px);
      // Only layers we add may fail; a ground that is already under AA is not ours.
      if (base >= 4.5) {
        assert.ok(c >= 4.5, `${g.name}: ${c.toFixed(2)} (base ${base.toFixed(2)})`);
        checked++;
        worst = Math.min(worst, c);
      }
    }
    // Not vacuous: every one of the six dry stops clears AA on its own, so all
    // of them (plus the wet grounds that do) must have been checked.
    assert.ok(checked >= SUNROOM_STOPS.length, `only ${checked} grounds checked`);
    if (process.env.WX_REPORT) console.log(`contrast: ${checked} grounds, worst ${worst.toFixed(2)}`);
  });
});

describe("applyWxPreview", () => {
  it("returns the same reference for unknown or missing presets", () => {
    const data = { status: "unreachable" as const };
    assert.equal(applyWxPreview(data, "nope", null), data);
    assert.equal(applyWxPreview(data, null, null), data);
  });
  it("builds a complete ok payload over an unreachable response", () => {
    const out = applyWxPreview({ status: "unreachable" }, "storm", null, new Date(2026, 10, 2));
    assert.equal(out?.status, "ok");
    assert.ok(out && out.status === "ok" && out.sun && out.sun.phase === "day");
    // Every field the header, forecast rail and radar read (kiosk-display WeatherOk).
    const full = out as unknown as {
      place: string;
      current: { tempC: number; feelsC: number; humidityPct: number; label: string; code: string };
      days: Array<{ date: string; code: string; label: string; maxC: number; minC: number; rainPct: number; sunrise: string; sunset: string }>;
      rain: { hours: unknown[]; summary: string | null };
    };
    assert.equal(typeof full.place, "string");
    assert.equal(full.current.label, "Thunderstorm");
    assert.equal(full.current.code, "thunderstorm");
    for (const k of ["tempC", "feelsC", "humidityPct"] as const) assert.ok(Number.isFinite(full.current[k]), k);
    assert.equal(full.days.length, 5);
    assert.deepEqual(full.days.map((d) => d.date), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
    for (const d of full.days) {
      assert.ok(!Number.isNaN(new Date(`${d.date}T00:00:00`).getTime()));
      assert.match(d.sunrise, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      assert.match(d.sunset, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      assert.equal(d.code, "thunderstorm");
    }
    assert.deepEqual(full.rain.hours, []);
    assert.equal(full.rain.summary, null);
  });
  it("wxsun and clear-night set the sun", () => {
    const night = applyWxPreview(undefined, "rain", "night");
    assert.ok(night && night.status === "ok" && night.sun?.elevationDeg === -25);
    const cn = applyWxPreview(undefined, "clear-night", null);
    assert.ok(cn && cn.status === "ok" && cn.sun?.elevationDeg === -25);
    const dusk = applyWxPreview(undefined, "rain", "dusk");
    assert.ok(dusk && dusk.status === "ok" && dusk.sun?.elevationDeg === -2);
  });
  it("keeps the real sun when no wxsun is given", () => {
    const real = { elevationDeg: 10, phase: "day" as const, progress01: 0.2, hourAngleDeg: -40 };
    const out = applyWxPreview({ status: "ok", sun: real }, "rain", null);
    assert.ok(out && out.status === "ok" && out.sun === real);
  });
  it("every preset lands on its table band", () => {
    const expected: Record<string, RainBand> = {
      off: "none", overcast: "none", drizzle: "drizzle", "rain-light": "light", rain: "moderate",
      "rain-heavy": "heavy", storm: "heavy", wind: "none", fog: "none", "clear-night": "none",
    };
    assert.deepEqual(Object.keys(WX_PRESETS).sort(), Object.keys(expected).sort());
    for (const [wx, band] of Object.entries(expected)) {
      const out = applyWxPreview(undefined, wx, null);
      assert.ok(out && out.status === "ok");
      assert.equal(rainBand(effectiveMmHr(out), out.current?.code), band, wx);
    }
  });
  it("effectiveMmHr prefers the nowcast and scales the 15-minute fallback by 4", () => {
    assert.equal(effectiveMmHr({ status: "ok", current: { precipMm: 0.5 }, rain: { nowcast: [{ minutesFromNow: 0, precipMmHr: 3 }] } }), 3);
    assert.equal(effectiveMmHr({ status: "ok", current: { precipMm: 0.5 } }), 2);
    assert.equal(effectiveMmHr({ status: "ok" }), 0);
  });
});

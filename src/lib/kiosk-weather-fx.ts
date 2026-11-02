/* Pure helpers for the sunroom weather effects. No DOM, no React, so
   `npm test` can pin the numbers (band cut-offs, counts, flash limits,
   contrast) that the renderer in kiosk-sunroom-particles.tsx only consumes. */

import type { KioskSunPhase, KioskWeatherOk, KioskWeatherResponse } from "./kiosk-client.ts";

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export type RainBand = "none" | "drizzle" | "light" | "moderate" | "heavy";
const RANK: Record<RainBand, number> = { none: 0, drizzle: 1, light: 2, moderate: 3, heavy: 4 };
const BY_RANK: RainBand[] = ["none", "drizzle", "light", "moderate", "heavy"];

/** The condition code sets a floor, so a header that says "Rain" is never
 *  drawn over a dry room when the first nowcast bucket happens to be 0. */
const CODE_FLOOR: Record<string, RainBand> = { drizzle: "drizzle", rain: "light", showers: "light", thunderstorm: "moderate" };

/** Standard light/moderate/heavy rain-rate cut-offs are 2.5 and 7.6 mm/h. */
export function rainBand(mmHr: number, code?: string): RainBand {
  const mm = Number.isFinite(mmHr) ? mmHr : 0;
  const byRate: RainBand = mm < 0.05 ? "none" : mm < 0.5 ? "drizzle" : mm < 2.5 ? "light" : mm < 7.6 ? "moderate" : "heavy";
  const floor = (code && CODE_FLOOR[code]) || "none";
  return BY_RANK[Math.max(RANK[byRate], RANK[floor])];
}

/** The nowcast is already mm/h. Open-Meteo's docs only give the 15-minute
 *  window sum for `precipitation` (the `current` block is built from that
 *  15-minute data), so the fallback is multiplied by 4, as weather.ts does
 *  for its own buckets. */
export function effectiveMmHr(ok: KioskWeatherOk): number {
  const now = ok.rain?.nowcast?.[0]?.precipMmHr;
  if (typeof now === "number" && Number.isFinite(now)) return now;
  const p = ok.current?.precipMm;
  return typeof p === "number" && Number.isFinite(p) ? p * 4 : 0;
}

export type WetBand = Exclude<RainBand, "none">;

export interface RainParams {
  count: number;
  speedNear: number;
  lengthNear: number;
  alphaNear: { dark: number; light: number };
  leanDeg: number;
  wobbleDeg: number;
}

const REF_AREA = 1180 * 820;
export const MAX_RAIN_STREAKS = 400;
// Drizzle's row is the MID band's values (it has no near band).
const TABLE: Record<WetBand, { count: number; speed: number; dark: number; light: number }> = {
  drizzle: { count: 70, speed: 420, dark: 0.08, light: 0.06 },
  light: { count: 140, speed: 900, dark: 0.11, light: 0.08 },
  moderate: { count: 240, speed: 1200, dark: 0.13, light: 0.09 },
  heavy: { count: 380, speed: 1500, dark: 0.14, light: 0.1 },
};

export function rainParams(band: WetBand, windKmh: number, w: number, h: number): RainParams {
  const t = TABLE[band];
  const wind = Math.max(0, Number.isFinite(windKmh) ? windKmh : 0);
  return {
    count: Math.min(MAX_RAIN_STREAKS, Math.round(t.count * Math.max(0.2, (w * h) / REF_AREA))),
    speedNear: t.speed,
    // 1.2 x one 30fps step, so a streak always covers its own per-frame travel.
    lengthNear: (t.speed / 30) * 1.2,
    alphaNear: { dark: t.dark, light: t.light },
    leanDeg: Math.min(25, (wind / 50) * 25),
    wobbleDeg: Math.min(4, (wind / 60) * 4),
  };
}

/** One shared lean for every streak, so near never crosses far. */
export function leanAt(p: RainParams, tSec: number): number {
  const g = 0.6 * Math.sin((tSec * 2 * Math.PI) / 5.3) + 0.4 * Math.sin((tSec * 2 * Math.PI) / 8.9);
  return p.leanDeg + p.wobbleDeg * g;
}

export type Depth = "far" | "mid" | "near";
const DEPTH = {
  far: { speed: 0.55, alpha: 0.45, width: 1 },
  mid: { speed: 0.75, alpha: 0.7, width: 1 },
  near: { speed: 1, alpha: 1, width: 1.5 },
};

export interface StreakSpec {
  depth: Depth;
  speed: number;
  length: number;
  width: number;
  /** Multiplier on `alphaNear` for this streak's depth. */
  aMult: number;
}

export function sampleStreak(p: RainParams, band: WetBand, rng: () => number): StreakSpec {
  const u = rng();
  const drizzle = band === "drizzle";
  const depth: Depth = drizzle ? (u < 0.5 ? "far" : "mid") : u < 0.4 ? "far" : u < 0.8 ? "mid" : "near";
  // Drizzle's table row IS the mid band, and its far band is that row x the
  // far factors; every other band's row is the near band.
  const d = drizzle && depth === "mid" ? { ...DEPTH.near, width: 1 } : DEPTH[depth];
  const speed = p.speedNear * d.speed * (0.85 + 0.3 * rng());
  // Length rides the streak's own jittered speed and only ever jitters up.
  const length = (speed / 30) * 1.2 * (1 + 0.2 * rng());
  return { depth, speed, length, width: d.width, aMult: d.alpha };
}

// --- lightning -------------------------------------------------------------

export const FLASH_PEAK_ALPHA = { dark: 0.18, light: 0.14 };
export const FLASH_GLOW_HEX = "#ecf2fc";
const DEFAULT_HOLD_MS = 60;
/** Second pulse starts this long after the strike (rise + hold + fall + gap). */
export const PULSE2_OFFSET_MS = 40 + DEFAULT_HOLD_MS + 80 + 80;

export function nextStrikeGapMs(rng: () => number): number {
  return 8000 + rng() * 17000;
}
export function isDoubleStrike(rng: () => number): boolean {
  return rng() < 0.5;
}

/** Pulse start times for a simulated run. Strikes are 8-25s apart and carry
 *  at most 2 pulses, so a second never holds more than 2 (WCAG 2.3.1 allows 3). */
export function flashPulses(rng: () => number, durationMs: number, firstAtMs?: number): Array<{ at: number; pulse: 1 | 2 }> {
  const out: Array<{ at: number; pulse: 1 | 2 }> = [];
  let at = firstAtMs ?? nextStrikeGapMs(rng);
  while (at < durationMs) {
    out.push({ at, pulse: 1 });
    if (isDoubleStrike(rng)) out.push({ at: at + PULSE2_OFFSET_MS, pulse: 2 });
    at += nextStrikeGapMs(rng);
  }
  return out;
}

/** Flash level 0..1 `tMs` after a strike: 40ms rise, hold, 80ms fall to 30%,
 *  then an optional second pulse to 70%, then a 450ms exponential decay. */
export function flashEnvelope(tMs: number, opts: { hold?: number; double?: boolean } = {}): number {
  const hold = opts.hold ?? DEFAULT_HOLD_MS;
  if (tMs < 0) return 0;
  const fallEnd = 40 + hold + 80;
  if (tMs < 40) return tMs / 40;
  if (tMs < 40 + hold) return 1;
  if (tMs < fallEnd) return 1 - (0.7 * (tMs - 40 - hold)) / 80;
  let level = 0.3;
  let from = fallEnd;
  if (opts.double) {
    const s = fallEnd + 80;
    if (tMs < s) return 0.3;
    if (tMs < s + 40) return 0.3 + (0.4 * (tMs - s)) / 40;
    level = 0.7;
    from = s + 40;
  }
  const dt = tMs - from;
  return dt >= 450 ? 0 : level * Math.exp(-dt / 110);
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relLum([r, g, b]: number[]): number {
  const l = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
}

/** WCAG relative-luminance change of `groundHex` when the glow is blended on
 *  at `alpha` (blended in sRGB, as the framebuffer does). */
export function flashPeakDeltaL(groundHex: string, alpha: number): number {
  const g = hexRgb(groundHex);
  const c = hexRgb(FLASH_GLOW_HEX);
  const blended = g.map((v, i) => v * (1 - alpha) + c[i] * alpha);
  return Math.abs(relLum(blended) - relLum(g));
}

// --- ?wx= preview ------------------------------------------------------------

type WxSun = "day" | "dusk" | "night";
interface Preset {
  code: string;
  label: string;
  cloud: number;
  mmHr: number;
  wind: number;
  sun?: WxSun;
}

export const WX_PRESETS: Record<string, Preset> = {
  off: { code: "clear", label: "Clear", cloud: 0, mmHr: 0, wind: 5 },
  overcast: { code: "cloudy", label: "Overcast", cloud: 95, mmHr: 0, wind: 15 },
  drizzle: { code: "drizzle", label: "Drizzle", cloud: 90, mmHr: 0.3, wind: 8 },
  "rain-light": { code: "rain", label: "Light rain", cloud: 95, mmHr: 1.2, wind: 12 },
  rain: { code: "rain", label: "Rain", cloud: 100, mmHr: 4, wind: 20 },
  "rain-heavy": { code: "rain", label: "Heavy rain", cloud: 100, mmHr: 12, wind: 35 },
  storm: { code: "thunderstorm", label: "Thunderstorm", cloud: 100, mmHr: 9, wind: 45 },
  wind: { code: "partly-cloudy", label: "Partly cloudy", cloud: 40, mmHr: 0, wind: 45 },
  fog: { code: "fog", label: "Fog", cloud: 100, mmHr: 0, wind: 3 },
  "clear-night": { code: "clear", label: "Clear", cloud: 0, mmHr: 0, wind: 5, sun: "night" },
};

const SUNS: Record<WxSun, NonNullable<KioskWeatherOk["sun"]>> = {
  day: { elevationDeg: 35, phase: "day" as KioskSunPhase, progress01: 0.5, hourAngleDeg: 0 },
  dusk: { elevationDeg: -2, phase: "dusk" as KioskSunPhase, progress01: 1, hourAngleDeg: 95 },
  night: { elevationDeg: -25, phase: "night" as KioskSunPhase, progress01: 1, hourAngleDeg: 180 },
};

const isSun = (s: unknown): s is WxSun => s === "day" || s === "dusk" || s === "night";

/** Local YYYY-MM-DD, the shape Open-Meteo's daily.time has. */
function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Synthetic weather for the session; an unknown preset leaves `data` alone
 *  (same reference). Sun: explicit wxsun, then the preset's, then the real
 *  one, then midday. The payload carries every field the header and forecast
 *  read too (kiosk-display's WeatherOk), so the whole screen agrees with the
 *  backdrop, even on a stack with no weather configured. */
export function applyWxPreview(
  data: KioskWeatherResponse | undefined,
  wx: string | null | undefined,
  wxsun: string | null | undefined,
  today: Date = new Date(),
): KioskWeatherResponse | undefined {
  if (!wx || !Object.hasOwn(WX_PRESETS, wx)) return data;
  const p = WX_PRESETS[wx];
  const forced = isSun(wxsun) ? wxsun : p.sun;
  const sun = forced ? SUNS[forced] : data?.status === "ok" && data.sun ? data.sun : SUNS.day;
  const wet = p.mmHr > 0 || p.code === "drizzle" || p.code === "rain" || p.code === "thunderstorm";
  const days = Array.from({ length: 5 }, (_, i) => {
    const date = localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
    return {
      date, code: p.code, label: p.label, maxC: 17, minC: 9, rainPct: wet ? 80 : 5,
      sunrise: `${date}T06:10`, sunset: `${date}T18:40`,
    };
  });
  const preview = {
    status: "ok" as const,
    place: "Preview",
    current: {
      tempC: 14, feelsC: 12, humidityPct: wet ? 90 : 60, windKmh: p.wind,
      // The real field is a 15-minute total; see effectiveMmHr.
      precipMm: p.mmHr / 4, cloudCoverPct: p.cloud, code: p.code, label: p.label,
    },
    days,
    rain: { nowcast: [{ minutesFromNow: 0, precipMmHr: p.mmHr }], hours: [], summary: null },
    sun,
  };
  return preview;
}

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
  if (code === "snow") return "none"; // no snow effect: snow keeps the cloud layer only
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
  drizzle: { count: 70, speed: 420, dark: 0.08, light: 0.11 },
  light: { count: 140, speed: 900, dark: 0.11, light: 0.15 },
  moderate: { count: 240, speed: 1200, dark: 0.13, light: 0.17 },
  heavy: { count: 380, speed: 1500, dark: 0.14, light: 0.19 },
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

// --- puddle line -----------------------------------------------------------

/* Rain marks beyond the streaks: rings on a wet floor, crowns on the forecast
   panel's top edge, a floor sheen. Index 0..3 is drizzle..heavy, 4 is storm. */
export const PUDDLE = {
  ringRate: { day: [12, 20, 26, 40, 48], dark: [8, 16, 26, 40, 48] },
  crownRate: [2, 5, 9, 14, 18],
  ringLife: { day: 0.9, dark: 1.4 },
  ringR: { day: [10, 24], dark: [14, 30] }, // base + span x u, before perspective
  ringKind: { day: 2.2, dark: 2.2 }, // shader sigma = 0.09 + (kind - 2) x 0.1
  ringAlpha: { day: 0.55, dark: 0.5 }, // day: slate ink; the one number to change if the rings read faint
  ringCrestDy: -1.2, // px; up, so the crest sits on the ring's near edge
  ringCrestAlpha: 0.35, // day only: the white crest on a ring's near edge
  crownAlpha: { day: 0.3, dark: 0.4 },
  crownLife: 0.35,
  crownRadius: 2.2,
  crownFloor: 0.3,
  sheenAlpha: { day: 0.1, dark: 0.06 },
  sheenFloor: { day: 1, dark: 0 }, // a daytime lightening needs no mask
  // The reduced-motion still: by day a slate wet band (a darkening, counted in the gate's still stack); dark as the sheen.
  stillSheenAlpha: { day: 0.12, dark: 0.06 },
  stillSheenFloor: { day: 1, dark: 0 },
  streakShare: 0.6,
  // Day is 0.3, not the shape brief's 0.5: a wet dawn ground (inkDim base 5.0) drops to 4.29 at 0.5.
  streakFloor: { day: 0.3, dark: 0.5 },
  streakFloorStormDark: 0.3,
  feather: 40,
  poolRings: 96,
  poolCrowns: 64,
  poolQuads: 192,
};

export interface PuddleParams {
  ringRate: number;
  ringLife: number;
  ringR0: number;
  ringRSpan: number;
  ringKind: number;
  ringAlpha: number;
  ringCrest: boolean;
  ringCrestAlpha: number;
  crownRate: number;
  crownAlpha: number;
  sheenAlpha: number;
  sheenFloor: number;
  stillSheenAlpha: number;
  stillSheenFloor: number;
  streakCount: number;
  streakFloor: number;
}

export function puddleParams(band: WetBand, storm: boolean, isDark: boolean, w: number, h: number): PuddleParams {
  const m = isDark ? "dark" : "day";
  const i = storm ? 4 : BY_RANK.indexOf(band) - 1;
  // Lengths scale with the stage, rates with its area, as rainParams scales count.
  const s = Math.min(w / 1280, h / 800);
  const area = (w * h) / (1280 * 800);
  return {
    ringRate: PUDDLE.ringRate[m][i] * area,
    ringLife: PUDDLE.ringLife[m],
    ringR0: PUDDLE.ringR[m][0] * s,
    ringRSpan: PUDDLE.ringR[m][1] * s,
    ringKind: PUDDLE.ringKind[m],
    ringAlpha: PUDDLE.ringAlpha[m],
    ringCrest: !isDark,
    ringCrestAlpha: PUDDLE.ringCrestAlpha,
    crownRate: PUDDLE.crownRate[i] * area,
    crownAlpha: PUDDLE.crownAlpha[m],
    sheenAlpha: PUDDLE.sheenAlpha[m],
    sheenFloor: PUDDLE.sheenFloor[m],
    stillSheenAlpha: PUDDLE.stillSheenAlpha[m],
    stillSheenFloor: PUDDLE.stillSheenFloor[m],
    streakCount: Math.round(PUDDLE.streakShare * rainParams(band, 0, w, h).count),
    streakFloor: storm && isDark ? PUDDLE.streakFloorStormDark : PUDDLE.streakFloor[m],
  };
}

/** 0 inside any zone rect, 1 at `feather` px or more from every one, a
 *  smoothstep between. `zones` is n rects as [x0, y0, x1, y1] in CSS px, y down.
 *  Allocates nothing: it runs per vertex per frame. */
export function zoneMask(x: number, y: number, zones: Float32Array, n: number, feather = PUDDLE.feather): number {
  let w = 1;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dx = Math.max(zones[o] - x, x - zones[o + 2], 0);
    const dy = Math.max(zones[o + 1] - y, y - zones[o + 3], 0);
    const t = Math.min(1, Math.hypot(dx, dy) / feather);
    w = Math.min(w, t * t * (3 - 2 * t));
  }
  return w;
}

/** `data-rain-zone` name -> mask slot. Same-named elements union into one rect,
 *  so names that sit apart (left cluster, centre pill, right corner) need their
 *  own slot or the union would blank the floor between them. Slots 1 and 2 are
 *  the glance gate (hasGlanceZones); a name that also shows in full mode must
 *  not use them. */
export const RAIN_ZONE_SLOT = { clock: 0, sentence: 1, tiles: 2, admin: 3, playing: 4 } as const;
export const RAIN_ZONE_COUNT = 5;

/** True when the glance text (slot 1, the centre column: every widget there, prose or control, carries
 *  the "sentence" zone; or tiles slot 2) is on screen. Absent slots hold -1e5. Without them (the hub) rings and crowns stay off. */
export function hasGlanceZones(zones: Float32Array): boolean {
  return zones[4] > -1e4 || zones[8] > -1e4;
}

/** True when a ring of final radius `r` at (x, y), drawn as the ellipse
 *  rx = r, ry = 0.3r + 1 grown by 12 px, misses every zone rect. */
export function ringSpawnOk(x: number, y: number, r: number, zones: Float32Array, n: number): boolean {
  const rx = r + 12;
  const ry = 0.3 * r + 1 + 12;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    // Axis-aligned ellipse vs rect: scale to a circle, then the rect's nearest point is a per-axis clamp.
    const nx = (Math.min(Math.max(x, zones[o]), zones[o + 2]) - x) / rx;
    const ny = (Math.min(Math.max(y, zones[o + 1]), zones[o + 3]) - y) / ry;
    if (nx * nx + ny * ny <= 1) return false;
  }
  return true;
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

/** The renderer's strike scheduler, one call per frame. Strikes are 8-25s
 *  apart and carry at most 2 pulses, so a second never holds more than 2
 *  (WCAG 2.3.1 allows 3). `firstAt` (absolute ms) is the preview's first
 *  strike: it fires once, as a single pulse held 500ms so a capture can land
 *  on it. Storm off disarms the clock. Returns the strike to start now. */
export function stepStrikes(
  clock: { nextAt: number; firstUsed: boolean },
  now: number,
  storm: boolean,
  rng: () => number,
  firstAt?: number,
): { at: number; hold: number; double: boolean } | null {
  if (!storm) {
    clock.nextAt = Infinity;
    return null;
  }
  const previewFirst = !clock.firstUsed && firstAt !== undefined;
  if (clock.nextAt === Infinity) clock.nextAt = previewFirst ? firstAt : now + nextStrikeGapMs(rng);
  if (now < clock.nextAt) return null;
  clock.firstUsed = true;
  clock.nextAt = now + nextStrikeGapMs(rng);
  return { at: now, hold: previewFirst ? 500 : DEFAULT_HOLD_MS, double: !previewFirst && isDoubleStrike(rng) };
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

/** A clear sky reads as a moon, not a sun, once the sun is down (elevation below the horizon). */
export function isNightGlyph(code: string, sun?: { elevationDeg: number }): boolean {
  return code === "clear" && !!sun && sun.elevationDeg < 0;
}

/** Weather condition word as the kiosk shows it: lowercase in every period (the night look used to keep the API's capital). */
export function conditionWord(label: string): string {
  return label.toLowerCase();
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

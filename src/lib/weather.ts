import { loadConfig } from "@/lib/config";

/**
 * Server-only Open-Meteo client for the public /kiosk weather card.
 * Open-Meteo is free and keyless, so there is no "unauthorized" status in
 * this module's vocabulary — only the "unconfigured" (no `display` block in
 * config.json) / "unreachable" (transport failure or non-2xx) / "ok" split
 * that ha.ts and hermes-ctl.ts also use. Coordinates are read from config and
 * NEVER echoed back in the response (see WeatherResponse) — the LAN-facing
 * kiosk only needs the place name, not the owner's exact lat/lon.
 */

const TIMEOUT_MS = 6000;
const CACHE_MS = 10 * 60 * 1000;

export type WeatherIconKey =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "showers"
  | "thunderstorm";

export interface WeatherNow {
  tempC: number | null;
  feelsC: number | null;
  humidityPct: number | null;
  windKmh: number | null;
  precipMm: number | null;
  cloudCoverPct: number;
  code: WeatherIconKey;
  label: string;
}

export interface WeatherDay {
  date: string;
  code: WeatherIconKey;
  label: string;
  maxC: number | null;
  minC: number | null;
  rainPct: number | null;
  sunrise: string | null;
  sunset: string | null;
}

/** Sun position for the kiosk's day/night chrome — a real solar-elevation
 *  read rather than a sunrise/sunset lookup, so "is it dawn right now" stays
 *  correct through the seasons without a second network round trip.
 *  `progress01` is 0 at sunrise and 1 at sunset (clamped outside daylight),
 *  computed from the same day's Open-Meteo sunrise/sunset when available. */
export interface WeatherSun {
  elevationDeg: number;
  phase: "night" | "dawn" | "day" | "dusk";
  progress01: number;
  /** Degrees of Earth rotation since solar noon at the configured lon,
   *  range -180..180: negative before solar noon (sun to the east),
   *  positive after (sun to the west). Advances a uniform 15°/hour, so a
   *  client can extrapolate the sun's position between this module's
   *  15-minute weather fetches without another round trip. */
  hourAngleDeg: number;
}

/** 15-minute precipitation nowcast (next ~90 min) plus a 12-hour probability
 *  outlook, both server-computed from Open-Meteo's minutely_15/hourly blocks
 *  so the kiosk only ever renders pre-shaped data. `summary` is short
 *  Melbourne-style microcopy derived from the nowcast ("rain in 20 min, done
 *  by 3:40") — null when there isn't enough data to say anything useful. */
export interface WeatherRain {
  nowcast: Array<{ minutesFromNow: number; precipMmHr: number }>;
  hours: Array<{ hourIso: string; probabilityPct: number; precipMm: number }>;
  summary: string | null;
}

export interface WeatherOk {
  status: "ok";
  place: string;
  current: WeatherNow;
  days: WeatherDay[];
  sun: WeatherSun;
  rain: WeatherRain;
}

export interface WeatherProblem {
  status: "unconfigured" | "unreachable";
  detail: string;
}

export type WeatherResponse = WeatherOk | WeatherProblem;

export const WEATHER_UNCONFIGURED_DETAIL =
  'No display config. Add a "display" block to data/config.json on the server: ' +
  '{ "display": { "lat": <num>, "lon": <num>, "place": "<name>", "timezone": "<IANA tz>" } }';

// --- WMO weather_code -> icon key / label ------------------------------------
// https://open-meteo.com/en/docs — the full WW table collapses to these nine
// buckets; any code not listed here (a future Open-Meteo addition) falls back
// to "cloudy" rather than rendering an unrecognized icon.
const WMO_LOOKUP: Record<number, { code: WeatherIconKey; label: string }> = {
  0: { code: "clear", label: "Clear" },
  1: { code: "clear", label: "Mainly clear" },
  2: { code: "partly-cloudy", label: "Partly cloudy" },
  3: { code: "cloudy", label: "Overcast" },
  45: { code: "fog", label: "Fog" },
  48: { code: "fog", label: "Rime fog" },
  51: { code: "drizzle", label: "Light drizzle" },
  53: { code: "drizzle", label: "Drizzle" },
  55: { code: "drizzle", label: "Dense drizzle" },
  56: { code: "drizzle", label: "Freezing drizzle" },
  57: { code: "drizzle", label: "Freezing drizzle" },
  61: { code: "rain", label: "Light rain" },
  63: { code: "rain", label: "Rain" },
  65: { code: "rain", label: "Heavy rain" },
  66: { code: "rain", label: "Freezing rain" },
  67: { code: "rain", label: "Freezing rain" },
  71: { code: "snow", label: "Light snow" },
  73: { code: "snow", label: "Snow" },
  75: { code: "snow", label: "Heavy snow" },
  77: { code: "snow", label: "Snow grains" },
  80: { code: "showers", label: "Light showers" },
  81: { code: "showers", label: "Showers" },
  82: { code: "showers", label: "Heavy showers" },
  85: { code: "snow", label: "Snow showers" },
  86: { code: "snow", label: "Heavy snow showers" },
  95: { code: "thunderstorm", label: "Thunderstorm" },
  96: { code: "thunderstorm", label: "Thunderstorm, hail" },
  99: { code: "thunderstorm", label: "Thunderstorm, heavy hail" },
};

function wmo(codeRaw: unknown): { code: WeatherIconKey; label: string } {
  const code = typeof codeRaw === "number" ? codeRaw : Number(codeRaw);
  return WMO_LOOKUP[code] ?? { code: "cloudy", label: "Cloudy" };
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

interface DisplayConfig {
  lat: number;
  lon: number;
  place: string;
  timezone: string;
}

function displayConfig(): DisplayConfig | null {
  const d = loadConfig().display;
  if (!d || typeof d.lat !== "number" || typeof d.lon !== "number" || !d.timezone) return null;
  return { lat: d.lat, lon: d.lon, place: d.place?.trim() || "Home", timezone: d.timezone };
}

// --- 10-minute module-level cache --------------------------------------------
// Long-lived Node server (not serverless), so a plain module variable is a
// valid cache — one Open-Meteo call feeds every kiosk tab/poll for 10 minutes
// rather than one call per request.
let cache: { at: number; data: WeatherResponse } | null = null;

interface RawCurrent {
  time?: unknown;
  temperature_2m?: unknown;
  apparent_temperature?: unknown;
  relative_humidity_2m?: unknown;
  weather_code?: unknown;
  precipitation?: unknown;
  wind_speed_10m?: unknown;
  cloud_cover?: unknown;
}

interface RawDaily {
  time?: unknown[];
  weather_code?: unknown[];
  temperature_2m_max?: unknown[];
  temperature_2m_min?: unknown[];
  precipitation_probability_max?: unknown[];
  sunrise?: unknown[];
  sunset?: unknown[];
}

interface RawMinutely15 {
  time?: unknown[];
  precipitation?: unknown[];
}

interface RawHourly {
  time?: unknown[];
  precipitation_probability?: unknown[];
  precipitation?: unknown[];
}

function mapCurrent(raw: RawCurrent): WeatherNow {
  const w = wmo(raw.weather_code);
  return {
    tempC: numOrNull(raw.temperature_2m),
    feelsC: numOrNull(raw.apparent_temperature),
    humidityPct: numOrNull(raw.relative_humidity_2m),
    windKmh: numOrNull(raw.wind_speed_10m),
    precipMm: numOrNull(raw.precipitation),
    cloudCoverPct: numOrNull(raw.cloud_cover) ?? 0,
    code: w.code,
    label: w.label,
  };
}

function mapDaily(raw: RawDaily): WeatherDay[] {
  const time = Array.isArray(raw.time) ? raw.time : [];
  return time.map((t, i) => {
    const w = wmo(raw.weather_code?.[i]);
    return {
      date: strOrNull(t) ?? "",
      code: w.code,
      label: w.label,
      maxC: numOrNull(raw.temperature_2m_max?.[i]),
      minC: numOrNull(raw.temperature_2m_min?.[i]),
      rainPct: numOrNull(raw.precipitation_probability_max?.[i]),
      sunrise: strOrNull(raw.sunrise?.[i]),
      sunset: strOrNull(raw.sunset?.[i]),
    };
  });
}

// --- sun position (NOAA solar-position algorithm) ----------------------------
// Pure trig from lat/lon + an absolute instant — the same math behind NOAA's
// published solar calculator. `Date` objects are always a true UTC instant
// internally (independent of the server process's own configured timezone),
// so `new Date()` here is safe to feed straight into the formula.

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

function solarPosition(date: Date, latDeg: number, lonDeg: number): { elevationDeg: number; hourAngleDeg: number } {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const Mrad = degToRad(M);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(Mrad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mrad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mrad) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(degToRad(omega));
  const meanObliq = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(degToRad(omega));
  const declRad = Math.asin(Math.sin(degToRad(obliqCorr)) * Math.sin(degToRad(apparentLong)));

  const y = Math.tan(degToRad(obliqCorr / 2)) ** 2;
  const eqTimeMin =
    4 *
    radToDeg(
      y * Math.sin(2 * degToRad(L0)) -
        2 * e * Math.sin(Mrad) +
        4 * e * y * Math.sin(Mrad) * Math.cos(2 * degToRad(L0)) -
        0.5 * y * y * Math.sin(4 * degToRad(L0)) -
        1.25 * e * e * Math.sin(2 * Mrad),
    );

  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = (utcMinutes + eqTimeMin + 4 * lonDeg + 1440) % 1440;
  let hourAngleDeg = trueSolarTime / 4 - 180;
  if (hourAngleDeg < -180) hourAngleDeg += 360;

  const latRad = degToRad(latDeg);
  const zenithRad = Math.acos(
    Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(degToRad(hourAngleDeg)),
  );
  return { elevationDeg: 90 - radToDeg(zenithRad), hourAngleDeg };
}

/** `currentIso`/`sunriseIso`/`sunsetIso` are all Open-Meteo-issued naive
 *  local timestamps in the config display timezone — diffing them directly
 *  (rather than converting through the server's own local clock) is what
 *  keeps `progress01` correct without a timezone library. */
function buildSun(cfg: DisplayConfig, currentIso: string | null, sunriseIso: string | null, sunsetIso: string | null): WeatherSun {
  const { elevationDeg, hourAngleDeg } = solarPosition(new Date(), cfg.lat, cfg.lon);
  const rising = hourAngleDeg < 0;

  let phase: WeatherSun["phase"];
  if (elevationDeg > 6) phase = "day";
  else if (elevationDeg < -6) phase = "night";
  else phase = rising ? "dawn" : "dusk";

  // Fallback when today's sunrise/sunset didn't come back: pin to the
  // daylight-elapsed extreme implied by the elevation reading alone.
  let progress01 = phase === "night" ? (rising ? 0 : 1) : 0.5;
  if (currentIso && sunriseIso && sunsetIso) {
    const nowMs = Date.parse(currentIso);
    const sunriseMs = Date.parse(sunriseIso);
    const sunsetMs = Date.parse(sunsetIso);
    if (Number.isFinite(nowMs) && Number.isFinite(sunriseMs) && Number.isFinite(sunsetMs) && sunsetMs > sunriseMs) {
      progress01 = Math.min(1, Math.max(0, (nowMs - sunriseMs) / (sunsetMs - sunriseMs)));
    }
  }

  return { elevationDeg, phase, progress01, hourAngleDeg };
}

// --- rain nowcast + summary microcopy ----------------------------------------

const RAIN_THRESHOLD_MM_HR = 0.2; // Open-Meteo's own light-drizzle floor

interface NowcastPoint {
  minutesFromNow: number;
  precipMmHr: number;
  iso: string;
}

/** Every 15-min bucket within [-7, 90] minutes of `nowIso`, capped at 7
 *  points (0..90 in 15-min steps). Bucket precipitation from Open-Meteo's
 *  minutely_15 block is an mm total *for that 15-min window*, so ×4 turns it
 *  into the mm/hr rate the UI actually wants to show. */
function buildNowcastPoints(raw: RawMinutely15, nowIso: string | null): NowcastPoint[] {
  const times = Array.isArray(raw.time) ? raw.time : [];
  const precip = Array.isArray(raw.precipitation) ? raw.precipitation : [];
  const nowMs = nowIso ? Date.parse(nowIso) : NaN;
  if (!Number.isFinite(nowMs) || times.length === 0) return [];

  const out: NowcastPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    const tIso = strOrNull(times[i]);
    if (!tIso) continue;
    const tMs = Date.parse(tIso);
    if (!Number.isFinite(tMs)) continue;
    const minutesFromNow = Math.round((tMs - nowMs) / 60000);
    if (minutesFromNow < -7 || minutesFromNow > 90) continue;
    const mmPer15 = numOrNull(precip[i]) ?? 0;
    out.push({ minutesFromNow: Math.max(0, minutesFromNow), precipMmHr: mmPer15 * 4, iso: tIso });
    if (out.length >= 7) break;
  }
  return out;
}

function buildHours(raw: RawHourly, nowIso: string | null): WeatherRain["hours"] {
  const times = Array.isArray(raw.time) ? raw.time : [];
  const prob = Array.isArray(raw.precipitation_probability) ? raw.precipitation_probability : [];
  const precip = Array.isArray(raw.precipitation) ? raw.precipitation : [];
  const nowMs = nowIso ? Date.parse(nowIso) : NaN;

  const out: WeatherRain["hours"] = [];
  for (let i = 0; i < times.length; i++) {
    const tIso = strOrNull(times[i]);
    if (!tIso) continue;
    const tMs = Date.parse(tIso);
    // Allow up to 30 min of slack before "now" so the in-progress hour bucket
    // isn't dropped just because it started a little earlier.
    if (Number.isFinite(nowMs) && Number.isFinite(tMs) && tMs < nowMs - 30 * 60000) continue;
    out.push({
      hourIso: tIso,
      probabilityPct: numOrNull(prob[i]) ?? 0,
      precipMm: numOrNull(precip[i]) ?? 0,
    });
    if (out.length >= 12) break;
  }
  return out;
}

/** "3:40" from an Open-Meteo local ISO datetime — 12-hour, no leading zero,
 *  no AM/PM (every summary is about the next 90 minutes, so it's unambiguous). */
function formatClock12(isoLocal: string): string {
  const t = isoLocal.indexOf("T");
  const timePart = t >= 0 ? isoLocal.slice(t + 1) : isoLocal;
  const [hStr, mStr] = timePart.split(":");
  let h = parseInt(hStr, 10);
  if (!Number.isFinite(h)) return timePart;
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr ?? "00"}`;
}

/** Melbourne-microcopy summary of the nowcast: "rain in 20 min, done by
 *  3:40", "rain easing in 25 min", "dry for the next 90 min". Null when
 *  there isn't a usable nowcast to summarize. */
function buildRainSummary(points: NowcastPoint[]): string | null {
  if (points.length === 0) return null;
  const wet = points.map((p) => p.precipMmHr > RAIN_THRESHOLD_MM_HR);
  if (!wet.some(Boolean)) return "dry for the next 90 min";

  if (wet[0]) {
    const endIdx = wet.findIndex((w, i) => i > 0 && !w);
    if (endIdx === -1) return "rain for the next 90 min";
    return `rain easing in ${points[endIdx].minutesFromNow} min`;
  }

  const startIdx = wet.findIndex(Boolean);
  const startPoint = points[startIdx];
  let endIdx = -1;
  for (let i = startIdx + 1; i < wet.length; i++) {
    if (!wet[i]) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return `rain in ${startPoint.minutesFromNow} min`;
  return `rain in ${startPoint.minutesFromNow} min, done by ${formatClock12(points[endIdx].iso)}`;
}

function buildRain(minutely: RawMinutely15, hourly: RawHourly, nowIso: string | null): WeatherRain {
  const points = buildNowcastPoints(minutely, nowIso);
  return {
    nowcast: points.map(({ minutesFromNow, precipMmHr }) => ({ minutesFromNow, precipMmHr })),
    hours: buildHours(hourly, nowIso),
    summary: buildRainSummary(points),
  };
}

export async function getWeather(): Promise<WeatherResponse> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const cfg = displayConfig();
  if (!cfg) return { status: "unconfigured", detail: WEATHER_UNCONFIGURED_DETAIL };

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${cfg.lat}&longitude=${cfg.lon}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation,wind_speed_10m,cloud_cover" +
    "&minutely_15=precipitation" +
    "&hourly=precipitation_probability,precipitation" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
    `&forecast_days=5&forecast_minutely_15=8&forecast_hours=13&timezone=${encodeURIComponent(cfg.timezone)}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return { status: "unreachable", detail: `Open-Meteo did not respond within ${TIMEOUT_MS / 1000}s.` };
  }
  if (!res.ok) return { status: "unreachable", detail: `Open-Meteo returned HTTP ${res.status}.` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { status: "unreachable", detail: "Open-Meteo returned a non-JSON response." };
  }
  const b = (body ?? {}) as {
    current?: RawCurrent;
    daily?: RawDaily;
    minutely_15?: RawMinutely15;
    hourly?: RawHourly;
  };

  const days = mapDaily(b.daily ?? {});
  const nowIso = strOrNull(b.current?.time);

  const data: WeatherResponse = {
    status: "ok",
    place: cfg.place,
    current: mapCurrent(b.current ?? {}),
    days,
    sun: buildSun(cfg, nowIso, days[0]?.sunrise ?? null, days[0]?.sunset ?? null),
    rain: buildRain(b.minutely_15 ?? {}, b.hourly ?? {}, nowIso),
  };
  cache = { at: Date.now(), data };
  return data;
}

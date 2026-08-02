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

export interface WeatherOk {
  status: "ok";
  place: string;
  current: WeatherNow;
  days: WeatherDay[];
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
  temperature_2m?: unknown;
  apparent_temperature?: unknown;
  relative_humidity_2m?: unknown;
  weather_code?: unknown;
  precipitation?: unknown;
  wind_speed_10m?: unknown;
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

function mapCurrent(raw: RawCurrent): WeatherNow {
  const w = wmo(raw.weather_code);
  return {
    tempC: numOrNull(raw.temperature_2m),
    feelsC: numOrNull(raw.apparent_temperature),
    humidityPct: numOrNull(raw.relative_humidity_2m),
    windKmh: numOrNull(raw.wind_speed_10m),
    precipMm: numOrNull(raw.precipitation),
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

export async function getWeather(): Promise<WeatherResponse> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const cfg = displayConfig();
  if (!cfg) return { status: "unconfigured", detail: WEATHER_UNCONFIGURED_DETAIL };

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${cfg.lat}&longitude=${cfg.lon}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation,wind_speed_10m" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
    `&forecast_days=5&timezone=${encodeURIComponent(cfg.timezone)}`;

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
  const b = (body ?? {}) as { current?: RawCurrent; daily?: RawDaily };

  const data: WeatherResponse = {
    status: "ok",
    place: cfg.place,
    current: mapCurrent(b.current ?? {}),
    days: mapDaily(b.daily ?? {}),
  };
  cache = { at: Date.now(), data };
  return data;
}

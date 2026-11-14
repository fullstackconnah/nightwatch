/* The desktop widget's glance (v1): a small, allowlisted view of the attention report.
 * Pure; relative or type-only imports so node:test can load it. */
import type { AttentionHit, AttentionReport } from "./attention-report.ts";
import { answerFor, type Tone } from "./home.ts";
import type { ContainerCounts } from "./container-counts.ts";
import { kioskVoiceEntities } from "./ha-settings-entities.ts";
import type { HaStatesResponse } from "./types/ha.ts";
import type { KioskVitalsData } from "./kiosk-vitals-view.ts";
import type { WeatherResponse } from "./weather.ts";
import type { KioskDownloadsResult } from "./types/downloads.ts";
import type { NowPlayingSnapshot } from "./types/nowplaying.ts";

export interface GlanceItem {
  id: string;
  severity: "warn" | "bad";
  headline: string;
  detail?: string;
  action?: string;
  since?: string;
  href: string;
}
export interface GlanceWeather {
  tempC: number | null;
  feelsC: number | null;
  label: string;
  highC: number | null;
  lowC: number | null;
  rainPct: number | null;
  /** A WeatherIconKey; the desk maps an unknown value or null to a cloud. */
  icon: string | null;
}
/** One of the days after today. Built field by field: nothing else from the weather day leaves the box. */
export interface GlanceForecastDay {
  /** A local calendar date, yyyy-MM-dd. May be "" when the upstream gave none; the desk skips it. */
  day: string;
  icon: string | null;
  highC: number | null;
  lowC: number | null;
  rainPct: number | null;
}
/** The one session the kiosk pill shows. Built key by key: no source, status, entity id or picture leaves the box. */
export interface GlanceNowPlaying {
  title: string;
  subtitle?: string;
  appName?: string;
  state: "playing" | "paused";
  progress01?: number;
}
export interface GlanceDownload {
  name: string;
  progress: number;
  speedBps: number;
  etaS: number | null;
}
/** `count` is every downloading item; `items` the first 3. No hash, size or path. */
export interface GlanceDownloads {
  count: number;
  items: GlanceDownload[];
}
/** Counts of the kiosk-visible lights only. No light name, id or brightness leaves the box. */
export interface GlanceHomeLights {
  lightsOn: number;
  lightsTotal: number;
}
/** The first available climate. `name` is the only name that leaves (cleaned, at most 24); absent when empty. Temps in °C. */
export interface GlanceHomeClimate {
  name?: string;
  mode: string;
  currentC: number | null;
  targetC: number | null;
}
export interface GlanceHome {
  lights: GlanceHomeLights | null;
  climate: GlanceHomeClimate | null;
}
/** Counts only: no container name, id or image. */
export interface GlanceContainers {
  total: number;
  running: number;
  restarting: number;
  unhealthy: number;
  dead: number;
}
export interface GlanceExtras {
  weather: GlanceWeather | null;
  forecast: GlanceForecastDay[] | null;
  camera: boolean;
  nowPlaying?: GlanceNowPlaying | null;
  downloads?: GlanceDownloads | null;
  home?: GlanceHome | null;
  containers?: GlanceContainers | null;
}
export interface Glance {
  v: 1;
  checkedAt: string;
  tone: Tone;
  answer: string;
  /** The orchestra hit (0 or 1; its id is constant), lifted out of the ranking so a stuck lane shows first. */
  lanes: GlanceItem[];
  items: GlanceItem[];
  probes: { answered: number; failed: number; pending: number };
  vitals: { cpu: number; mem: number; diskMax: number | null } | null;
  weather: GlanceWeather | null;
  /** The next 4 days at most (days[1..4] of the same weather fetch); null when weather is. */
  forecast: GlanceForecastDay[] | null;
  /** True when the desk camera is switched on AND a door camera resolves; the widget hides its block otherwise. */
  camera: boolean;
  /** Null when nothing plays or the source is slow or down. */
  nowPlaying: GlanceNowPlaying | null;
  /** Null when qBittorrent is unconfigured, unreachable or slow. */
  downloads: GlanceDownloads | null;
  /** Null when HA is slow, down or has nothing to show; its lights part is also null when the hidden list cannot be read. */
  home: GlanceHome | null;
  /** Null when docker is unreachable or slow. */
  containers: GlanceContainers | null;
}

// A path stays; a plain in-page anchor ("#backup") is made absolute so the widget opens Home at it; all else is Home.
function hrefFor(href: string): string {
  if (href.startsWith("/")) return href;
  return /^#[a-z][a-z0-9-]*$/.test(href) ? `/${href}` : "/";
}

// Copy field by field: a hit may carry more than it declares, and none of it may leave the box.
function toItem(h: AttentionHit): GlanceItem {
  const item: GlanceItem = {
    id: h.id,
    severity: h.severity,
    headline: h.headline,
    href: hrefFor(h.owner.href),
  };
  if (h.detail !== undefined) item.detail = h.detail;
  if (h.action !== undefined) item.action = h.action;
  if (h.since !== undefined) item.since = h.since;
  return item;
}

export function buildGlance(report: AttentionReport, vitals: KioskVitalsData | null, extras: GlanceExtras = { weather: null, forecast: null, camera: false }): Glance {
  const { tone, text } = answerFor({ report, error: false, running: null, backupAgo: null });
  const count = (state: string) => report.probes.filter((p) => p.state === state).length;
  return {
    v: 1,
    checkedAt: report.checkedAt,
    tone,
    answer: text,
    lanes: report.hits.filter((h) => h.probe === "orchestra").map(toItem),
    items: report.hits.filter((h) => h.probe !== "orchestra").map(toItem),
    probes: { answered: count("answered"), failed: count("failed"), pending: count("pending") },
    vitals: vitals
      ? {
          cpu: vitals.cpu.percent,
          mem: vitals.memory.percent,
          diskMax: vitals.disk.length ? Math.max(...vitals.disk.map((d) => d.percent)) : null,
        }
      : null,
    weather: extras.weather,
    forecast: extras.forecast,
    camera: extras.camera,
    nowPlaying: extras.nowPlaying ?? null,
    downloads: extras.downloads ?? null,
    home: extras.home ?? null,
    containers: extras.containers ?? null,
  };
}

/** Allowlist: today's numbers and the label only. No coordinates, place, humidity, wind or sun leave the box. */
export function glanceWeather(w: WeatherResponse): GlanceWeather | null {
  if (w.status !== "ok") return null;
  const day = w.days[0];
  return {
    tempC: w.current.tempC,
    feelsC: w.current.feelsC,
    label: w.current.label,
    highC: day?.maxC ?? null,
    lowC: day?.minC ?? null,
    rainPct: day?.rainPct ?? null,
    icon: w.current.code ?? null,
  };
}

/** Allowlist: the 4 days after today, each copied field by field. `[]` when only today came back. */
export function glanceForecast(w: WeatherResponse): GlanceForecastDay[] | null {
  if (w.status !== "ok") return null;
  return w.days.slice(1, 5).map((d) => ({ day: d.date, icon: d.code ?? null, highC: d.maxC ?? null, lowC: d.minC ?? null, rainPct: d.rainPct ?? null }));
}

/** The route's one weather fetch feeds both fields; null for both when it is slow, down or unconfigured. */
export function glanceWeatherExtras(get: () => Promise<WeatherResponse>, ms: number): Promise<Pick<GlanceExtras, "weather" | "forecast">> {
  return within(get().then((w) => ({ weather: glanceWeather(w), forecast: glanceForecast(w) })), ms, { weather: null, forecast: null });
}

// Mirrors the widget's Copy.Trim: UTF-16 length, `n-1` units plus an ellipsis, never splitting a surrogate pair.
// Control characters and line or paragraph separators become one space first, so a title never carries a newline into the widget.
function cap(raw: string, n: number): string {
  const s = raw.replace(/[\0-\x1f\x7f\u{2028}\u{2029}]+/gu, " ").trim();
  if (s.length <= n) return s;
  let end = n - 1;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return `${s.slice(0, end)}…`;
}
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Allowlist: title, subtitle, app name, state and progress. Idle, an empty title or an unknown state is null. */
export function glanceNowPlaying(s: NowPlayingSnapshot): GlanceNowPlaying | null {
  if (s.status !== "ok" || !s.title || (s.state !== "playing" && s.state !== "paused")) return null;
  const title = cap(s.title, 80);
  if (!title || /^[a-z_]+\.[a-z0-9_]+$/.test(title)) return null; // HA's friendlyName falls back to the entity id: never send that as a title
  const out: GlanceNowPlaying = { title, state: s.state };
  const subtitle = s.subtitle ? cap(s.subtitle, 80) : "";
  const appName = s.appName ? cap(s.appName, 24) : "";
  if (subtitle) out.subtitle = subtitle;
  if (appName) out.appName = appName;
  if (finite(s.progress01)) out.progress01 = clamp01(s.progress01);
  return out;
}

/** Allowlist: `count` of every downloading item, then the first 3 as name, progress, speed and ETA. No hash, size or path. */
export function glanceDownloads(r: KioskDownloadsResult): GlanceDownloads | null {
  if (r.status !== "ok") return null;
  return {
    count: r.items.length,
    items: r.items
      .map((d) => ({
        name: cap(d.name, 60),
        progress: finite(d.progress) ? clamp01(d.progress) : 0,
        speedBps: finite(d.dlspeed) && d.dlspeed > 0 ? d.dlspeed : 0,
        etaS: finite(d.eta) && d.eta >= 0 ? Math.round(d.eta) : null,
      }))
      .filter((d) => d.name) // a name that was only control characters is dropped; count still has it
      .slice(0, 3),
  };
}

/** Each source races its own `ms` timer; a throw (even a synchronous one), a rejection or a hang gives null for it alone. */
export async function glanceMediaExtras(
  np: () => Promise<NowPlayingSnapshot>,
  dl: () => Promise<KioskDownloadsResult>,
  ms: number,
): Promise<{ nowPlaying: GlanceNowPlaying | null; downloads: GlanceDownloads | null }> {
  const [nowPlaying, downloads] = await Promise.all([
    within(Promise.resolve().then(np).then(glanceNowPlaying), ms, null),
    within(Promise.resolve().then(dl).then(glanceDownloads), ms, null),
  ]);
  return { nowPlaying, downloads };
}

const KNOWN_HVAC = new Set(["off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"]);

// °F converts; anything else is taken as °C. A non-finite or implausible reading is null, never a made-up number.
function celsius(v: unknown, unit: string | null): number | null {
  if (!finite(v)) return null;
  const c = Math.round((unit === "°F" ? ((v - 32) * 5) / 9 : v) * 10) / 10;
  return c >= -50 && c <= 60 ? c : null;
}

/**
 * Allowlist from the kiosk-visible entities: light counts, and the first available climate with a known mode.
 * `hidden` null (the registry read failed) fails closed: no lights, so a hidden light is never counted. Climates are never hideable.
 */
export function glanceHome(r: HaStatesResponse, hidden: ReadonlySet<string> | null): GlanceHome | null {
  if (r.status !== "ok" || !r.entities) return null;
  const visible = kioskVoiceEntities(r.entities, hidden);
  const lightsTotal = visible.lights.length;
  const lights = lightsTotal > 0 ? { lightsOn: visible.lights.filter((l) => l.on === true && l.available !== false).length, lightsTotal } : null;
  const c = visible.climates.find((x) => x.available !== false && KNOWN_HVAC.has(x.hvacMode));
  let climate: GlanceHomeClimate | null = null;
  if (c) {
    // friendlyName() falls back to the entity id; an id must never leave the box
    const name = c.name === c.entityId ? "" : cap(c.name ?? "", 24);
    climate = { ...(name ? { name } : {}), mode: c.hvacMode, currentC: celsius(c.currentTemp, c.unit), targetC: celsius(c.targetTemp, c.unit) };
  }
  return lights || climate ? { lights, climate } : null;
}

/** Copied field by field: `paused` and `stopped` stay on the kiosk route. */
export function glanceContainers(c: ContainerCounts): GlanceContainers {
  return { total: c.total, running: c.running, restarting: c.restarting, unhealthy: c.unhealthy, dead: c.dead };
}

/**
 * HOME's two sources, each in its own `ms` race, so a throw (even a synchronous one), a rejection or a hang gives null for it alone.
 * The hidden-list race ends 100 ms early on purpose: when the registry is slow, the lights go null while the climate still shows.
 */
export async function glanceHomeExtras(
  ha: () => Promise<HaStatesResponse>,
  hidden: () => Promise<ReadonlySet<string>>,
  counts: () => Promise<ContainerCounts>,
  ms: number,
): Promise<{ home: GlanceHome | null; containers: GlanceContainers | null }> {
  const [home, containers] = await Promise.all([
    within(
      Promise.all([Promise.resolve().then(ha), within<ReadonlySet<string> | null>(Promise.resolve().then(hidden), ms - 100, null)]).then(([r, h]) => glanceHome(r, h)),
      ms,
      null,
    ),
    within(Promise.resolve().then(counts).then(glanceContainers), ms, null),
  ]);
  return { home, containers };
}

/** Resolves to `fallback` on a throw or when `p` takes longer than `ms`, so a slow upstream cannot slow the poll. */
export async function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<T>((r) => (timer = setTimeout(() => r(fallback), ms)))]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/* The desktop widget's glance (v1): a small, allowlisted view of the attention report.
 * Pure; relative or type-only imports so node:test can load it. */
import type { AttentionHit, AttentionReport } from "./attention-report.ts";
import { answerFor, type Tone } from "./home.ts";
import type { KioskVitalsData } from "./kiosk-vitals-view.ts";
import type { WeatherResponse } from "./weather.ts";

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
export interface GlanceExtras {
  weather: GlanceWeather | null;
  camera: boolean;
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
  /** True when the desk camera is switched on AND a door camera resolves; the widget hides its block otherwise. */
  camera: boolean;
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

export function buildGlance(report: AttentionReport, vitals: KioskVitalsData | null, extras: GlanceExtras = { weather: null, camera: false }): Glance {
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
    camera: extras.camera,
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

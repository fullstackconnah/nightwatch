"use client";

/* THESIS: the smart-display layer for /kiosk — weather and a time-of-day
   aware content band that sits between KioskStatusStrip and KioskHub (plus a
   full-page night treatment page.tsx renders on its own). Layout is a static
   choice per period, not a rotation: morning gets the weight (big current
   card + forecast + a briefing digest that's expensive to fetch), day and
   evening compress to a single row so the hub below keeps most of the
   screen. OWN-WORLD: same .panel / microlabel / mono vocabulary and the same
   hatch-not-empty + SWR/keepPreviousData idioms kiosk-hub.tsx uses against
   its own /kiosk/api/ha/* contract — composed fresh here against
   /kiosk/api/weather and /kiosk/api/briefing rather than importing from
   kiosk-hub, which points at a different endpoint family entirely.

   A weather failure must never take the hub down with it: unconfigured and
   unreachable-with-no-data render as small, self-contained panels (a hatch
   panel and an inline error line, mirroring HubUnconfigured/HubStatusIssue),
   and an unreachable read that still has a last-known-good payload keeps
   showing it with a tiny stale tag rather than blanking. */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  AlertTriangle,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Droplets,
  type LucideIcon,
  Newspaper,
  Sun,
  Sunrise,
  Sunset,
  Wind,
} from "lucide-react";
import { fetcher } from "@/lib/client";
import { formatWallClock } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { StaleTag } from "@/components/kiosk-stale-tag";

// color-mix against the live --color-ink-faint token, not a literal rgb: the
// old rgba(77,97,122,…) was exactly the *default* theme's ink-faint baked
// in, so every kiosk theme's unconfigured/empty texture rendered in that
// one dark-blue tint regardless of which theme was active. This resolves
// against whichever [data-kiosk-theme] scope the element renders inside.
const HATCH_PATTERN =
  "repeating-linear-gradient(135deg, transparent 0 8px, color-mix(in srgb, var(--color-ink-faint) 14%, transparent) 8px 10px)";

/* ── period ──────────────────────────────────────────────────────────────── */

export type KioskPeriod = "morning" | "day" | "evening" | "night";

const PERIOD_RECOMPUTE_MS = 60_000;

// Exported so kiosk-activity.ts's useKioskNight() can derive the night window
// from this exact boundary rather than restating "22:00-05:00" as a second
// literal that could quietly drift out of step with the night overlay this
// function already drives via useKioskPeriod below.
export function computePeriod(date: Date): KioskPeriod {
  const h = date.getHours();
  if (h >= 5 && h < 10) return "morning";
  if (h >= 10 && h < 17) return "day";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

function isKioskPeriod(v: string | null): v is KioskPeriod {
  return v === "morning" || v === "day" || v === "evening" || v === "night";
}

/** Local-device-time period, recomputed every minute. A `?period=` override is
 *  read once on mount (not tracked reactively — it exists for testing/demos,
 *  not for a URL that changes underneath a running kiosk) and then wins
 *  permanently for the session. Starts at "day" rather than computing the real
 *  period during the initial render: that render also runs on the server,
 *  which has no reliable claim to this device's local clock, so seeding with
 *  the real answer risks a hydration mismatch — the correct period lands a
 *  tick later from the effect instead, the same "0 means not yet known" shape
 *  useNow uses. */
export function useKioskPeriod(): KioskPeriod {
  const searchParams = useSearchParams();
  const [override] = useState<KioskPeriod | null>(() => {
    const raw = searchParams.get("period");
    return isKioskPeriod(raw) ? raw : null;
  });
  const [period, setPeriod] = useState<KioskPeriod>("day");

  useEffect(() => {
    if (override) {
      setPeriod(override);
      return;
    }
    const tick = () => setPeriod(computePeriod(new Date()));
    tick();
    const id = setInterval(tick, PERIOD_RECOMPUTE_MS);
    return () => clearInterval(id);
  }, [override]);

  return period;
}

/* ── weather contract ───────────────────────────────────────────────────── */

type WeatherIconKey =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "showers"
  | "thunderstorm";

interface WeatherCurrent {
  tempC: number;
  feelsC: number;
  humidityPct: number;
  windKmh: number;
  precipMm: number;
  code: WeatherIconKey;
  label: string;
}

export interface WeatherDay {
  date: string;
  code: WeatherIconKey;
  label: string;
  maxC: number;
  minC: number;
  rainPct: number;
  sunrise: string;
  sunset: string;
}

/** Open-Meteo returns local ISO datetimes ("2026-08-02T07:19") — only the
 *  clock part belongs on screen. */
function clockOf(isoLocal: string): string {
  const t = isoLocal.indexOf("T");
  return t >= 0 ? isoLocal.slice(t + 1) : isoLocal;
}

/** Mirrors weather.ts's WeatherRain — 15-min precip nowcast (~90 min) plus a
 *  12-hour probability outlook and server-composed summary microcopy. */
interface WeatherRain {
  nowcast: Array<{ minutesFromNow: number; precipMmHr: number }>;
  hours: Array<{ hourIso: string; probabilityPct: number; precipMm: number }>;
  summary: string | null;
}

interface WeatherOk {
  status: "ok";
  place: string;
  current: WeatherCurrent;
  days: WeatherDay[];
  rain?: WeatherRain;
}

type WeatherResponse =
  | WeatherOk
  | { status: "unconfigured"; detail?: string }
  | { status: "unreachable"; detail?: string };

export const WEATHER_ICON: Record<WeatherIconKey, LucideIcon> = {
  clear: Sun,
  "partly-cloudy": CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  showers: CloudRainWind,
  thunderstorm: CloudLightning,
};

const WEATHER_REFRESH_MS = 15 * 60_000;

type WeatherViewStatus = "loading" | "unconfigured" | "unreachable-empty" | "ready" | "ready-stale";

interface WeatherView {
  status: WeatherViewStatus;
  ok: WeatherOk | null;
  detail?: string;
}

/** Wraps the raw SWR response so "unreachable but we still have yesterday's
 *  reading" and "unreachable and we've never had one" render differently —
 *  SWR's own `data` just becomes whatever the latest fetch returned, so the
 *  last good payload is tracked here rather than relied on from
 *  keepPreviousData (which only bridges a revalidation in flight, not a
 *  fetch that completed with a different shape). */
export function useWeatherView(): WeatherView {
  const { data, error, isLoading } = useSWR<WeatherResponse>("/kiosk/api/weather", fetcher, {
    refreshInterval: WEATHER_REFRESH_MS,
    keepPreviousData: true,
  });
  const [lastOk, setLastOk] = useState<WeatherOk | null>(null);
  useEffect(() => {
    if (data?.status === "ok") setLastOk(data);
  }, [data]);

  if (!data) {
    if (isLoading) return { status: "loading", ok: lastOk };
    if (lastOk) return { status: "ready-stale", ok: lastOk };
    return { status: "unreachable-empty", ok: null, detail: error instanceof Error ? error.message : undefined };
  }
  if (data.status === "unconfigured") return { status: "unconfigured", ok: null, detail: data.detail };
  if (data.status === "unreachable") {
    return lastOk
      ? { status: "ready-stale", ok: lastOk, detail: data.detail }
      : { status: "unreachable-empty", ok: null, detail: data.detail };
  }
  return { status: "ready", ok: data };
}

/* ── briefing contract ──────────────────────────────────────────────────── */

interface BriefingDigest {
  headline: string;
  body: string;
  actionNeeded: string;
}

interface BriefingNews {
  summary?: string;
  headlines: string[];
  source: string;
}

type BriefingResponse =
  | { status: "ok"; date: string; digest?: BriefingDigest; news?: BriefingNews }
  // The server route reports failure as "unconfigured" (no display block);
  // accept any non-ok literal so a future status never falls through to the
  // ok-render with empty fields.
  | { status: "unavailable" | "unconfigured"; detail?: string };

const BRIEFING_POLL_MS = 10_000;

/** The endpoint is expensive on the first call of the day (~45s) — poll every
 *  10s until content actually lands, then stop; `unavailable` also stops,
 *  there is nothing to wait for. */
export function useKioskBriefing(active: boolean) {
  return useSWR<BriefingResponse>(active ? "/kiosk/api/briefing" : null, fetcher, {
    refreshInterval: (latest?: BriefingResponse) => {
      if (!latest) return BRIEFING_POLL_MS;
      if (latest.status === "ok" && !latest.digest && !latest.news) return BRIEFING_POLL_MS;
      return 0;
    },
    keepPreviousData: true,
  });
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

function SectionLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={13} className="text-ink-faint" aria-hidden />
      {/* Real heading, not a styled span — same promotion kiosk-hub.tsx's
          SectionHeader made for Lights/Switches/Scenes/Climate/Sensors, so a
          screen-reader user navigating by heading also lands on the weather
          band and the briefing card. `.microlabel` carries the visuals
          unchanged; Tailwind's preflight zeroes the browser's own h2
          margin/size. */}
      <h2 className="microlabel">{label}</h2>
    </div>
  );
}

function MicroDatum({ icon: Icon, label, value }: { icon?: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1 text-ink-faint">
        {Icon && <Icon size={11} aria-hidden />}
        <span className="microlabel">{label}</span>
      </div>
      <span className="font-mono text-sm text-ink">{value}</span>
    </div>
  );
}

/* ── weather non-happy states (mirrors kiosk-hub's Hub* states) ─────────── */

function WeatherUnconfigured() {
  return (
    <div role="status" className="panel relative flex items-center gap-3 overflow-hidden px-4 py-3">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: HATCH_PATTERN }} />
      <Cloud size={18} className="relative text-ink-faint" aria-hidden />
      <div className="relative">
        <div className="microlabel !text-warn">Weather not configured</div>
      </div>
    </div>
  );
}

function WeatherUnreachable({ detail }: { detail?: string }) {
  return (
    <div role="status" className="panel flex flex-wrap items-center gap-2 px-4 py-3">
      <span className="dot dot-dead" aria-hidden />
      <span className="microlabel !text-bad">Weather unreachable</span>
      {detail && <span className="text-xs text-ink-dim">{detail}</span>}
    </div>
  );
}

function WeatherSkeleton() {
  return <div className="h-16 animate-pulse rounded-md bg-panel-2 motion-reduce:animate-none" />;
}

/* ── current weather ─────────────────────────────────────────────────────── */

function CurrentWeatherLarge({
  current,
  today,
  place,
  stale,
  rain,
}: {
  current: WeatherCurrent;
  today: WeatherDay;
  place: string;
  stale: boolean;
  rain?: WeatherRain;
}) {
  // No icon/temp/label here (redesign-06 follow-up, 2026-08-03): the shared
  // header (kiosk-surface.tsx's TempNode) already states the current reading
  // once, ~150px above this band, and both were visible on screen at once.
  // This band now carries only what the header doesn't: feels-like, wind,
  // humidity, sunrise, place, staleness, and the rain nowcast/ribbon.
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 text-ink-faint">
          {place && <span className="text-xs">{place}</span>}
          {stale && <StaleTag />}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <MicroDatum label="feels" value={`${Math.round(current.feelsC)}°`} />
          <MicroDatum icon={Droplets} label="rain" value={`${current.precipMm.toFixed(1)} mm`} />
          <MicroDatum icon={Wind} label="wind" value={`${Math.round(current.windKmh)} km/h`} />
          <MicroDatum label="humidity" value={`${Math.round(current.humidityPct)}%`} />
          <MicroDatum icon={Sunrise} label="sunrise" value={clockOf(today.sunrise)} />
        </div>
      </div>
      {rain && <RainNowcastBand rain={rain} />}
      {rain && <RainHourlyRibbon hours={rain.hours} />}
    </div>
  );
}

function CurrentWeatherCompact({
  current,
  today,
  mode,
  stale,
  rain,
}: {
  current: WeatherCurrent;
  today: WeatherDay;
  mode: "day" | "evening";
  stale: boolean;
  rain?: WeatherRain;
}) {
  // No icon/temp/label here either — same duplicate-reading fix as
  // CurrentWeatherLarge above. Feels-like joins the day row (it wasn't shown
  // in this compact variant before) since it's cheap supplementary context
  // once the current reading itself moves out.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {mode === "day" ? (
        <span className="font-mono text-sm text-ink-faint">
          feels {Math.round(current.feelsC)}° · H {Math.round(today.maxC)}° · L {Math.round(today.minC)}° ·{" "}
          {today.rainPct}% rain
        </span>
      ) : (
        <span className="flex items-center gap-1 font-mono text-sm text-ink-faint">
          <Sunset size={12} aria-hidden />
          sunset {clockOf(today.sunset)}
        </span>
      )}
      {rain?.summary && <RainSummaryText summary={rain.summary} className="text-xs text-ink-dim" />}
      {stale && <StaleTag />}
    </div>
  );
}

/* ── rain timeline ───────────────────────────────────────────────────────── */
// Server-shaped nowcast/hourly data rendered as two small hand-rolled SVG/DOM
// pieces, morning-card only (day/evening get the summary sentence alone —
// see CurrentWeatherCompact). Mono-Is-Data: the sentence is prose (sans),
// but the minute/clock figures inside it are numbers, so they're pulled out
// into mono spans rather than left in the sans run.

const RAIN_FIGURE_RE = /(\d+\s*min|\d{1,2}:\d{2})/g;

function RainSummaryText({ summary, className }: { summary: string; className?: string }) {
  const parts = summary.split(RAIN_FIGURE_RE);
  return (
    <span className={className}>
      {parts.map((part, i) => (i % 2 === 1 ? <span key={i} className="font-mono">{part}</span> : <span key={i}>{part}</span>))}
    </span>
  );
}

const NOWCAST_W = 320;
const NOWCAST_H = 36;
// Fixed 0/15/30/45/60/75/90-minute grid: bar position comes from this slot
// count, never from how many points the server actually returned, so a
// short/uneven nowcast array can't push a bar past the viewBox.
const NOWCAST_SLOTS = 7;
const NOWCAST_SLOT_W = NOWCAST_W / NOWCAST_SLOTS;

/** ~36px SVG band: 15-min precip bars over a hairline baseline. Renders no
 *  bars at all when every bucket is dry — the summary sentence alone carries
 *  "dry for the next 90 min" rather than drawing a flat empty strip. Renders
 *  nothing whatsoever when there's no nowcast and no summary to show, so a
 *  data-missing morning never leaves a dead box under the current reading. */
function RainNowcastBand({ rain }: { rain: WeatherRain }) {
  const { nowcast, summary } = rain;
  if (nowcast.length === 0 && !summary) return null;

  const hasBars = nowcast.some((p) => p.precipMmHr > 0);
  const peak = hasBars ? Math.max(...nowcast.map((p) => p.precipMmHr)) : 1;
  const baselineY = NOWCAST_H - 5;

  return (
    <div className="mt-3">
      {summary && <RainSummaryText summary={summary} className="text-xs text-ink-dim" />}
      {hasBars && (
        <svg
          viewBox={`0 0 ${NOWCAST_W} ${NOWCAST_H}`}
          preserveAspectRatio="none"
          className="mt-1 h-9 w-full"
          aria-hidden
        >
          <line
            x1={0}
            y1={baselineY}
            x2={NOWCAST_W}
            y2={baselineY}
            stroke="var(--color-line-bright)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {nowcast.map((p) => {
            const slot = Math.min(NOWCAST_SLOTS - 1, Math.round(p.minutesFromNow / 15));
            const x = slot * NOWCAST_SLOT_W;
            const barH = Math.max(1.5, (p.precipMmHr / peak) * (baselineY - 4));
            return (
              <rect
                key={p.minutesFromNow}
                x={x + NOWCAST_SLOT_W * 0.15}
                y={baselineY - barH}
                width={Math.max(1, NOWCAST_SLOT_W * 0.7)}
                height={barH}
                rx={1}
                fill="var(--color-blue)"
                opacity={0.85}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** 12 tiny cells, opacity-mapped to rain probability, with a "now" tick at
 *  the left edge (hours[0] is the current/next hour bucket). Omitted
 *  entirely — no hatched placeholder — when the hourly block didn't come
 *  back, per spec: this is outlook furniture, not a reading that failed. */
function RainHourlyRibbon({ hours }: { hours: WeatherRain["hours"] }) {
  if (hours.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="microlabel mb-1.5">next 12h rain</div>
      <div className="relative flex h-3 gap-0.5">
        <span aria-hidden className="absolute -top-1.5 left-0 h-1.5 w-px bg-ink-faint" />
        {hours.slice(0, 12).map((h) => (
          <div
            key={h.hourIso}
            className="h-full min-w-0 flex-1 rounded-sm"
            style={{ backgroundColor: "var(--color-blue)", opacity: Math.max(0.08, Math.min(1, h.probabilityPct / 100)) }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── weather band ────────────────────────────────────────────────────────── */

function WeatherBand({ period, weather }: { period: KioskPeriod; weather: WeatherView }) {
  if (weather.status === "unconfigured") return <WeatherUnconfigured />;
  if (weather.status === "unreachable-empty") return <WeatherUnreachable detail={weather.detail} />;
  if (weather.status === "loading" || !weather.ok) return <WeatherSkeleton />;

  const { current, days, place, rain } = weather.ok;
  const today = days[0];
  const stale = weather.status === "ready-stale";

  // The forecast rail used to render here (a `days.length > 0 &&` block
  // below the current reading). redesign-06 §5 moves it out: the rail is
  // now owned by kiosk-surface.tsx's shared header in both glance and full
  // mode (see that file's structural-rule comment), so it's the same DOM
  // node across the mode transition instead of two separate copies. This
  // band keeps the current reading and the rain nowcast/ribbon, unchanged.
  // No box: not a touch target or alert, just open ground (redesign-06 §E).
  // It's the first thing in the full-view content stack, so nothing sits
  // above it to separate from.
  return (
    <section>
      {period === "morning" ? (
        <CurrentWeatherLarge current={current} today={today} place={place} stale={stale} rain={rain} />
      ) : (
        <CurrentWeatherCompact
          current={current}
          today={today}
          mode={period === "evening" ? "evening" : "day"}
          stale={stale}
          rain={rain}
        />
      )}
    </section>
  );
}

/* ── morning briefing ────────────────────────────────────────────────────── */

function BriefingCard({ briefing }: { briefing: ReturnType<typeof useKioskBriefing> }) {
  const { data } = briefing;
  const preparing = !data || (data.status === "ok" && !data.digest && !data.news);

  // No box: a hairline top rule groups it with the weather band above
  // instead (redesign-06 §E) — the same "type and space do the grouping"
  // treatment as the hub's sections.
  if (preparing) {
    return (
      <section className="border-t border-line pt-3">
        <SectionLabel icon={Newspaper} label="Morning Briefing" />
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-dim">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint motion-reduce:animate-none" aria-hidden />
          briefing is being prepared…
        </div>
      </section>
    );
  }

  if (data.status !== "ok") {
    return (
      <section className="border-t border-line pt-3">
        <SectionLabel icon={Newspaper} label="Morning Briefing" />
        <p className="mt-2 text-xs text-ink-faint">Briefing unavailable.</p>
      </section>
    );
  }

  const { digest, news } = data;
  const actionWarn = Boolean(digest && digest.actionNeeded !== "no");
  const newsLines = news
    ? news.summary
      ? news.summary.split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean)
      : news.headlines.slice(0, 4)
    : [];

  return (
    <section className="border-t border-line pt-3">
      <SectionLabel icon={Newspaper} label="Morning Briefing" />

      {digest && (
        <div className="mt-2">
          <div className="text-sm font-semibold text-ink">{digest.headline}</div>
          {/* The digest body arrives as inline "- x - y - z" prose; on a
              glance-first surface that reads as a log dump. Split it back
              into the list it was born as (impeccable layout finding). */}
          <ul className="mt-1 space-y-1 text-xs text-ink-dim">
            {digest.body
              .split(/(?:^|\s)-\s+/)
              .map((item) => item.trim())
              .filter(Boolean)
              .map((item, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="text-ink-faint">–</span>
                  <span>{item}</span>
                </li>
              ))}
          </ul>
          {actionWarn && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-warn">
              <AlertTriangle size={12} aria-hidden />
              Action needed: {digest.actionNeeded}
            </div>
          )}
        </div>
      )}

      {news && (
        <div className={digest ? "mt-3 border-t border-line pt-3" : "mt-2"}>
          <ul className="space-y-1">
            {newsLines.map((line, i) => (
              <li key={i} className="text-xs text-ink-dim">
                {line}
              </li>
            ))}
          </ul>
          <div className="microlabel mt-1.5">{news.source}</div>
        </div>
      )}
    </section>
  );
}

/* ── display band (morning / day / evening) ─────────────────────────────── */

export function KioskDisplay({ period }: { period: KioskPeriod }) {
  const weather = useWeatherView();
  // Already night-backed-off structurally, not just by rate: `active` false
  // outside "morning" passes SWR a `null` key, which stops polling outright
  // rather than merely slowing it down. Nobody reads a 3am briefing, and this
  // was already the case before the 2026-08 idle/night pass — noted here so
  // that pass doesn't get "fixed" a second time onto a poll that isn't running.
  const briefing = useKioskBriefing(period === "morning");

  return (
    <div className="space-y-3">
      <WeatherBand period={period} weather={weather} />
      {period === "morning" && <BriefingCard briefing={briefing} />}
    </div>
  );
}

/* ── night overlay (page.tsx renders this in place of everything else) ──── */

export function KioskNightOverlay({
  onAdminClick,
  onWake,
}: {
  onAdminClick: () => void;
  onWake: () => void;
}) {
  const now = useNow(true);
  const date = now === 0 ? null : new Date(now);
  const weather = useWeatherView();
  const current = weather.ok?.current ?? null;
  const Icon = current ? WEATHER_ICON[current.code] : null;
  const night = date ? formatWallClock(date) : null;

  return (
    <div
      className="relative flex min-h-[70vh] flex-1 flex-col items-center justify-center gap-4"
      onPointerDown={onWake}
    >
      <span className="font-mono tabular-nums leading-none text-ink text-6xl md:text-8xl">
        {night ? night.time : "--:--"}
        {night && <span className="ml-2 text-[0.32em] text-ink-dim">{night.period}</span>}
      </span>

      {current && Icon && (
        <div className="flex items-center gap-2">
          <Icon size={20} className="text-ink-faint" aria-hidden />
          <span className="font-mono text-lg text-ink-dim">{Math.round(current.tempC)}°</span>
          <span className="text-sm text-ink-faint">{current.label}</span>
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAdminClick();
        }}
        className="absolute right-3 top-3 h-11 rounded-md px-4 text-xs text-ink-faint outline-none hover:bg-panel-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
      >
        Admin
      </button>
    </div>
  );
}

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
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const HATCH_PATTERN =
  "repeating-linear-gradient(135deg, transparent 0 8px, rgba(77,97,122,0.14) 8px 10px)";

/* ── period ──────────────────────────────────────────────────────────────── */

export type KioskPeriod = "morning" | "day" | "evening" | "night";

const PERIOD_RECOMPUTE_MS = 60_000;

function computePeriod(date: Date): KioskPeriod {
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

interface WeatherDay {
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

interface WeatherOk {
  status: "ok";
  place: string;
  current: WeatherCurrent;
  days: WeatherDay[];
}

type WeatherResponse =
  | WeatherOk
  | { status: "unconfigured"; detail?: string }
  | { status: "unreachable"; detail?: string };

const WEATHER_ICON: Record<WeatherIconKey, LucideIcon> = {
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
function useWeatherView(): WeatherView {
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
function useKioskBriefing(active: boolean) {
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
      <span className="microlabel">{label}</span>
    </div>
  );
}

/** Not a `.dot-*` variant on purpose — those states (running/unhealthy/dead…)
 *  describe container health, and a fifth "stale" meaning would have to be
 *  invented and taught. This is plain warn-tinted text, earned by a real
 *  threshold (the fetch is confirmed unreachable), not decoration. */
function StaleTag() {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[0.65rem] text-warn">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warn" />
      stale
    </span>
  );
}

function MicroDatum({ icon: Icon, label, value }: { icon?: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1 text-ink-faint">
        {Icon && <Icon size={11} aria-hidden />}
        <span className="microlabel">{label}</span>
      </div>
      <span className="font-mono text-xs text-ink">{value}</span>
    </div>
  );
}

/* ── weather non-happy states (mirrors kiosk-hub's Hub* states) ─────────── */

function WeatherUnconfigured() {
  return (
    <div className="panel relative flex items-center gap-3 overflow-hidden px-4 py-3">
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
    <div className="panel flex flex-wrap items-center gap-2 px-4 py-3">
      <span className="dot dot-dead" aria-hidden />
      <span className="microlabel !text-bad">Weather unreachable</span>
      {detail && <span className="text-xs text-ink-dim">{detail}</span>}
    </div>
  );
}

function WeatherSkeleton() {
  return (
    <div className="panel p-4">
      <div className="h-16 animate-pulse rounded-md bg-panel-2 motion-reduce:animate-none" />
    </div>
  );
}

/* ── current weather ─────────────────────────────────────────────────────── */

function CurrentWeatherLarge({
  current,
  today,
  place,
  stale,
}: {
  current: WeatherCurrent;
  today: WeatherDay;
  place: string;
  stale: boolean;
}) {
  const Icon = WEATHER_ICON[current.code];
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-4">
        <Icon size={44} className="shrink-0 text-ink-dim" aria-hidden />
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-4xl leading-none text-ink">{Math.round(current.tempC)}°</span>
            <span className="text-sm text-ink-dim">{current.label}</span>
          </div>
          <div className="mt-1 font-mono text-xs text-ink-faint">
            feels like {Math.round(current.feelsC)}°{place ? ` · ${place}` : ""}
          </div>
          {stale && (
            <div className="mt-1">
              <StaleTag />
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <MicroDatum icon={Droplets} label="rain" value={`${current.precipMm.toFixed(1)} mm`} />
        <MicroDatum icon={Wind} label="wind" value={`${Math.round(current.windKmh)} km/h`} />
        <MicroDatum label="humidity" value={`${Math.round(current.humidityPct)}%`} />
        <MicroDatum icon={Sunrise} label="sunrise" value={clockOf(today.sunrise)} />
      </div>
    </div>
  );
}

function CurrentWeatherCompact({
  current,
  today,
  mode,
  stale,
}: {
  current: WeatherCurrent;
  today: WeatherDay;
  mode: "day" | "evening";
  stale: boolean;
}) {
  const Icon = WEATHER_ICON[current.code];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <div className="flex items-center gap-2">
        <Icon size={22} className="shrink-0 text-ink-dim" aria-hidden />
        <span className="font-mono text-2xl leading-none text-ink">{Math.round(current.tempC)}°</span>
        <span className="text-xs text-ink-dim">{current.label}</span>
      </div>
      {mode === "day" ? (
        <span className="font-mono text-xs text-ink-faint">
          H {Math.round(today.maxC)}° · L {Math.round(today.minC)}° · {today.rainPct}% rain
        </span>
      ) : (
        <span className="flex items-center gap-1 font-mono text-xs text-ink-faint">
          <Sunset size={12} aria-hidden />
          sunset {clockOf(today.sunset)}
        </span>
      )}
      {stale && <StaleTag />}
    </div>
  );
}

/* ── forecast strip ──────────────────────────────────────────────────────── */

const DAY_FMT = new Intl.DateTimeFormat("en-AU", { weekday: "short" });

function dayLabel(dateStr: string, index: number): string {
  if (index === 0) return "Today";
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : DAY_FMT.format(d);
}

// 5 fixed columns, no scroll: the emphasized (tomorrow, evening only) column
// borrows the segmented-control idiom — accent tint marks "the featured one",
// same as an active tab — rather than inventing a new emphasis device.
function ForecastStrip({ days, emphasizeIndex }: { days: WeatherDay[]; emphasizeIndex: number | null }) {
  return (
    <div className="mt-4">
      <div className="microlabel mb-2">5-Day Forecast</div>
      <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {days.map((day, i) => {
          const Icon = WEATHER_ICON[day.code];
          const emphasized = i === emphasizeIndex;
          return (
            <div
              key={day.date}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-md border px-1 py-1.5 text-center",
                emphasized ? "border-accent/40 bg-accent/10" : "border-line bg-panel-2",
              )}
            >
              <span className={cn("microlabel", emphasized && "!text-accent")}>{dayLabel(day.date, i)}</span>
              <Icon size={16} className={emphasized ? "text-accent" : "text-ink-dim"} aria-hidden />
              <span className="font-mono text-[0.7rem] text-ink">
                {Math.round(day.maxC)}°<span className="text-ink-faint">/{Math.round(day.minC)}°</span>
              </span>
              <span className="flex items-center gap-0.5 font-mono text-[0.6rem] text-ink-faint">
                <Droplets size={8} aria-hidden />
                {day.rainPct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── weather band ────────────────────────────────────────────────────────── */

function WeatherBand({ period, weather }: { period: KioskPeriod; weather: WeatherView }) {
  if (weather.status === "unconfigured") return <WeatherUnconfigured />;
  if (weather.status === "unreachable-empty") return <WeatherUnreachable detail={weather.detail} />;
  if (weather.status === "loading" || !weather.ok) return <WeatherSkeleton />;

  const { current, days, place } = weather.ok;
  const today = days[0];
  const stale = weather.status === "ready-stale";

  return (
    <section className="panel p-4">
      {period === "morning" ? (
        <CurrentWeatherLarge current={current} today={today} place={place} stale={stale} />
      ) : (
        <CurrentWeatherCompact current={current} today={today} mode={period === "evening" ? "evening" : "day"} stale={stale} />
      )}
      {days.length > 0 && <ForecastStrip days={days} emphasizeIndex={period === "evening" ? 1 : null} />}
    </section>
  );
}

/* ── morning briefing ────────────────────────────────────────────────────── */

function BriefingCard({ briefing }: { briefing: ReturnType<typeof useKioskBriefing> }) {
  const { data } = briefing;
  const preparing = !data || (data.status === "ok" && !data.digest && !data.news);

  if (preparing) {
    return (
      <section className="panel p-4">
        <SectionLabel icon={Newspaper} label="Morning Briefing" />
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-faint">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint motion-reduce:animate-none" aria-hidden />
          briefing is being prepared…
        </div>
      </section>
    );
  }

  if (data.status !== "ok") {
    return (
      <section className="panel p-4">
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
    <section className="panel p-4">
      <SectionLabel icon={Newspaper} label="Morning Briefing" />

      {digest && (
        <div className="mt-2">
          <div className="text-sm font-semibold text-ink">{digest.headline}</div>
          <p className="mt-1 text-xs text-ink-dim">{digest.body}</p>
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
  const briefing = useKioskBriefing(period === "morning");

  return (
    <div className="space-y-4">
      <WeatherBand period={period} weather={weather} />
      {period === "morning" && <BriefingCard briefing={briefing} />}
    </div>
  );
}

/* ── night overlay (page.tsx renders this in place of everything else) ──── */

const NIGHT_TIME_FMT = new Intl.DateTimeFormat("en-AU", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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

  return (
    <div
      className="relative flex min-h-[70vh] flex-1 flex-col items-center justify-center gap-4"
      onPointerDown={onWake}
    >
      <span className="font-mono tabular-nums leading-none text-ink text-6xl md:text-8xl">
        {date ? NIGHT_TIME_FMT.format(date) : "--:--"}
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

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

import { useEffect, useMemo, useState } from "react";
import { useKioskTheme } from "@/components/kiosk/kiosk-theme";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  AlertTriangle,
  CalendarDays,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  type LucideIcon,
  Moon,
  Newspaper,
  Sun,
  Sunset,
} from "lucide-react";
import { BinNightRow, useBinNight } from "@/components/kiosk/kiosk-bins";
import { type KioskAgenda, useKioskAgenda } from "@/components/kiosk/kiosk-calendar";
import { KioskNowPlaying } from "@/components/kiosk/kiosk-now-playing";
import { type KioskWeatherOk, WEATHER_REFRESH_MS, briefingFetcher, getBriefingAnsweredAt, getWeatherLastOkAt, useWxParams, weatherFetcher } from "@/lib/kiosk-client";
import { applyWxPreview, conditionWord, isNightGlyph } from "@/lib/kiosk-weather-fx";
import { formatWallClock } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { type SunAirAir, type SunAirInlineItem, type SunAirTone, type SunAirUv, type SunAirView, sunAirView } from "@/lib/kiosk-sun-air";
import { briefingRefreshMs, briefingTooOld } from "@/lib/briefing-poll";
import { type WeatherViewStatus, weatherViewStatus } from "@/lib/kiosk/view-status";
import { StaleTag } from "@/components/kiosk/kiosk-stale-tag";

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
  /** Same payload as KioskWeatherOk.sun; only the night glyph reads it here. */
  sun?: KioskWeatherOk["sun"];
  /** UV and air for the sun-air view (kiosk-sun-air.ts); absent on a payload cached before they existed. */
  uv?: SunAirUv | null;
  air?: SunAirAir | null;
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

/** The glyph for the current reading: the moon for a clear sky with the sun down, else WEATHER_ICON. */
export function currentGlyph(code: WeatherIconKey, sun?: { elevationDeg: number }): LucideIcon {
  return isNightGlyph(code, sun) ? Moon : WEATHER_ICON[code];
}

/* The interval is imported, the RESPONSE TYPE is not, deliberately.
   SWR dedupes by key only while every subscriber's interval agrees, so that
   constant now has exactly one home (kiosk-client.ts). The type is a different
   story: this view reads the FORECAST half of the payload — `place`, `days[]`,
   a fully-typed `current` — where the backdrops read a loose atmospheric
   subset. Collapsing the two would have to widen every required field here to
   optional, which is a real loss of type safety on the most-read surface of
   the kiosk to remove a duplication that costs nothing. */

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
  const now = useNow(true, true); // minute tick re-evaluates the age while a failing fetch sits open; 0 before mount
  const { data: raw, error, isLoading } = useSWR<WeatherResponse>("/kiosk/api/weather", weatherFetcher, {
    refreshInterval: WEATHER_REFRESH_MS,
    keepPreviousData: true,
  });
  const lastOkAt = getWeatherLastOkAt(); // shared by every instance; stamped in weatherFetcher
  // The ?wx= preview fills every field this view reads (see applyWxPreview),
  // so the header agrees with the backdrop. Memoised for the [data] effect.
  const { wx, wxsun } = useWxParams();
  const data = useMemo(() => applyWxPreview(raw, wx, wxsun) as WeatherResponse | undefined, [raw, wx, wxsun]);
  const [lastOk, setLastOk] = useState<WeatherOk | null>(null);
  useEffect(() => {
    if (data?.status === "ok") setLastOk(data);
  }, [data]);

  const status = weatherViewStatus({
    hasData: !!data,
    payload: data?.status,
    hasError: !!error,
    isLoading,
    hasLastOk: !!lastOk,
    lastOkAgeMs: lastOkAt !== null && now > lastOkAt ? now - lastOkAt : undefined, // now 0 or a clock moved back: undefined
  });
  const errorMessage = error instanceof Error ? error.message : undefined;
  if (!data) {
    return status === "unreachable-empty"
      ? { status, ok: null, detail: errorMessage }
      : { status, ok: lastOk };
  }
  if (data.status === "unconfigured") return { status, ok: null, detail: data.detail };
  if (data.status === "unreachable") {
    return { status, ok: status === "ready-stale" ? lastOk : null, detail: data.detail };
  }
  // A failed revalidation beside kept data: data is the last good reading, unless it aged out.
  if (status === "unreachable-empty") return { status, ok: null, detail: errorMessage };
  return { status, ok: data, detail: status === "ready-stale" ? errorMessage : undefined };
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

/** The endpoint is expensive on the first call of the day (~45s) — poll every
 *  10s until content actually lands, then every 30 min (also after
 *  `unavailable`): the server's per-day cache is cheap to poll and rolls the
 *  day itself, so a wall display picks up tomorrow's digest. */
export function useKioskBriefing(active: boolean) {
  return useSWR<BriefingResponse>(active ? "/kiosk/api/briefing" : null, briefingFetcher, {
    // old kept data is no data: poll fast again until a fresh answer stamps the time
    refreshInterval: (latest) => briefingRefreshMs(briefingTooOld(getBriefingAnsweredAt(), Date.now()) ? undefined : latest),
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

/** The UV and air view, recomputed as the wall clock passes the peak and sunset (shared by the Standard inline and the glance pane). */
export function useSunAirView(ok: WeatherOk | null) {
  // Minute ticks: the view changes only at the peak time and sunset. 0 is "not yet known" (hydration), so no view then.
  const now = useNow(true, true);
  return useMemo(() => (now === 0 ? null : sunAirView(ok, new Date(now))), [ok, now]);
}

export const SUN_AIR_TONE_CLASS: Record<SunAirTone, string> = { none: "text-ink-dim", warn: "text-warn", bad: "text-bad" };

/** One inline UV or air item in the weather line: the label stays faint, the value takes the tone. */
function SunAirInline({ item }: { item: SunAirInlineItem }) {
  const sr = useKioskTheme() === "sunroom";
  return (
    <span data-sun-inline="" key={sr ? item.text : undefined} className={sr ? "whitespace-nowrap font-mono text-sm text-ink-faint sr-fade-in" : "whitespace-nowrap font-mono text-sm text-ink-faint"}>
      {item.label} <span className={SUN_AIR_TONE_CLASS[item.tone]}>{item.text.slice(item.label.length + 1)}</span>
    </span>
  );
}

/* ── weather non-happy states (mirrors kiosk-hub's Hub* states) ─────────── */

function WeatherUnconfigured() {
  return (
    <div role="status" className="panel relative flex items-center gap-3 overflow-hidden px-4 py-3">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: HATCH_PATTERN }} />
      <Cloud size={18} className="relative text-ink-faint" aria-hidden />
      <div className="relative">
        <div className="microlabel !text-warn" data-sr-tone="warn">Weather not configured</div>
      </div>
    </div>
  );
}

function WeatherUnreachable({ detail }: { detail?: string }) {
  return (
    <div role="status" className="panel flex flex-wrap items-center gap-2 px-4 py-3">
      <span className="dot dot-dead" aria-hidden />
      <span className="microlabel !text-bad" data-sr-tone="bad">Weather unreachable</span>
      {detail && <span className="text-xs text-ink-dim">{detail}</span>}
    </div>
  );
}

function WeatherSkeleton() {
  return <div className="h-16 animate-pulse rounded-md bg-panel-2 motion-reduce:animate-none" />;
}

/* ── current weather ─────────────────────────────────────────────────────── */

function CurrentWeatherCompact({
  current,
  today,
  mode,
  stale,
  rain,
  sunAir,
}: {
  current: WeatherCurrent;
  today: WeatherDay;
  mode: "day" | "evening";
  stale: boolean;
  rain?: WeatherRain;
  sunAir: SunAirView | null;
}) {
  // No icon/temp/label here either — same duplicate-reading fix as
  // CurrentWeatherLarge above. Feels-like joins the day row (it wasn't shown
  // in this compact variant before) since it's cheap supplementary context
  // once the current reading itself moves out.
  const sr = useKioskTheme() === "sunroom";
  return (
    <div data-weather-line="" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {mode === "day" ? (
        <span
          key={sr ? `${Math.round(current.feelsC)}|${today.rainPct}` : undefined}
          className={sr ? "font-mono text-sm text-ink-faint sr-fade-in" : "font-mono text-sm text-ink-faint"}
          data-sr-num=""
        >
          feels {Math.round(current.feelsC)}° · {today.rainPct}% rain
        </span>
      ) : (
        <span className="flex items-center gap-1 font-mono text-sm text-ink-faint">
          <Sunset size={12} aria-hidden />
          sunset {clockOf(today.sunset)}
        </span>
      )}
      {rain?.summary && <RainSummaryText summary={rain.summary} className="text-xs text-ink-dim" />}
      {sunAir?.inline.uv && <SunAirInline item={sunAir.inline.uv} />}
      {sunAir?.inline.air && <SunAirInline item={sunAir.inline.air} />}
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

/* ── weather band ────────────────────────────────────────────────────────── */

/** The header's fifth child (full only): feels, rain, UV and air under the temperature. Always the compact line: the morning's large reading repeated the hero temperature. */
export function WeatherBand({ period, weather }: { period: KioskPeriod; weather: WeatherView }) {
  const sunAir = useSunAirView(weather.ok);
  if (weather.status === "unconfigured") return <WeatherUnconfigured />;
  if (weather.status === "unreachable-empty") return <WeatherUnreachable detail={weather.detail} />;
  if (weather.status === "loading" || !weather.ok) return <WeatherSkeleton />;

  const { current, days, rain } = weather.ok;
  const today = days[0];
  const stale = weather.status === "ready-stale";

  return (
    <section className="min-w-0 basis-full lg:basis-auto">
      <CurrentWeatherCompact
        current={current}
        today={today}
        mode={period === "evening" ? "evening" : "day"}
        stale={stale}
        rain={rain}
        sunAir={sunAir}
      />
    </section>
  );
}

/* ── morning briefing ────────────────────────────────────────────────────── */

function BriefingCard({ briefing }: { briefing: ReturnType<typeof useKioskBriefing> }) {
  const { data } = briefing;
  const now = useNow(true, true); // minute tick; 0 before mount reads as not old
  const preparing =
    !data || (data.status === "ok" && !data.digest && !data.news) || briefingTooOld(getBriefingAnsweredAt(), now);

  // No box: a hairline top rule groups it with the weather band above
  // instead (redesign-06 §E) — the same "type and space do the grouping"
  // treatment as the hub's sections.
  if (preparing) {
    return (
      <section>
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
      <section>
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
    <section>
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

/* ── calendar (today's and tomorrow's events) ───────────────────────────── */

/** The agenda's one home on Standard: at most 3 rows and one "and N more" row. 0 px (no node) when there is nothing to say. */
function CalendarSection({ agenda: { view, failed } }: { agenda: KioskAgenda }) {
  if (!view && !failed) return null;
  return (
    <section data-calendar-section="">
      {failed && <p className="text-xs text-ink-faint">Calendar unavailable.</p>}
      {view && (
        <ul className="space-y-1 text-sm">
          {view.rows.map((r) => (
            <li key={r.id} data-agenda-row="" className="flex items-baseline gap-2">
              <span className="w-16 shrink-0 text-xs text-ink-faint">{r.day}</span>
              <span className={`w-20 shrink-0 font-mono ${r.now ? "text-ink" : "text-ink-dim"}`}>{r.time}</span>
              <span className={`min-w-0 truncate ${r.dim ? "text-ink-dim" : "text-ink"}`}>{r.title}</span>
              {r.till && <span className="shrink-0 text-xs text-ink-faint">{r.till}</span>}
            </li>
          ))}
          {view.more && <li data-agenda-more="" className="pl-[4.5rem] text-ink-dim">{view.more}</li>}
        </ul>
      )}
    </section>
  );
}

/* ── display band (morning / day / evening) ─────────────────────────────── */

/** The Today cell's content (kiosk-hub.tsx owns the cell and its span): briefing in the morning, bin night in the evening, the agenda, and what is playing at the foot. */
export function KioskDisplay({ period }: { period: KioskPeriod }) {
  // Already night-backed-off structurally, not just by rate: `active` false
  // outside "morning" passes SWR a `null` key, which stops polling outright
  // rather than merely slowing it down. Nobody reads a 3am briefing, and this
  // was already the case before the 2026-08 idle/night pass — noted here so
  // that pass doesn't get "fixed" a second time onto a poll that isn't running.
  const briefing = useKioskBriefing(period === "morning");
  const agenda = useKioskAgenda();
  const bins = useBinNight(period);
  // The cell stays so the board keeps its shape. The morning briefing always has a card, so it never reads "nothing".
  const nothingOn = period !== "morning" && !bins && !agenda.view && !agenda.failed;

  return (
    <>
      <div className="flex items-center gap-2">
        <SectionLabel icon={CalendarDays} label="Today" />
        {/* -my-1: the 24 px sunroom pill overflows the label's line evenly, so nothing below it moves */}
        {agenda.stale && <span className="-my-1 flex"><StaleTag /></span>}
      </div>
      {period === "morning" && <BriefingCard briefing={briefing} />}
      <BinNightRow period={period} />
      <CalendarSection agenda={agenda} />
      {nothingOn && <p data-today-empty="" className="text-sm text-ink-dim">Nothing on today or tomorrow</p>}
      <KioskNowPlaying docked />
    </>
  );
}

/* ── night overlay (page.tsx renders this in place of everything else) ──── */

export function KioskNightOverlay({
  onAdminClick,
  onWake,
}: {
  /** Rect param lets the tapped Admin button feed the PIN pad's container-
   *  transform origin (kiosk-motion.ts's containerExpand) — see page.tsx's
   *  openPinPad. */
  onAdminClick: (rect?: DOMRect) => void;
  onWake: () => void;
}) {
  const now = useNow(true);
  const date = now === 0 ? null : new Date(now);
  const weather = useWeatherView();
  const current = weather.ok?.current ?? null;
  const Icon = current ? currentGlyph(current.code, weather.ok?.sun) : null;
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
          <span className="text-sm text-ink-faint">{conditionWord(current.label)}</span>
        </div>
      )}

      <button
        type="button"
        data-sr-admin
        onClick={(e) => {
          e.stopPropagation();
          onAdminClick(e.currentTarget.getBoundingClientRect());
        }}
        className="absolute right-3 top-3 h-11 rounded-md px-4 text-[15px] text-ink-faint outline-none hover:bg-panel-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
      >
        Admin
      </button>
    </div>
  );
}

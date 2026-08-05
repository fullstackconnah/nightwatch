"use client";

/* THESIS: the widget registry behind the reorderable glance carousel and the
   full-mode extra-content list (kiosk-carousel.tsx, kiosk-surface.tsx,
   kiosk-appearance.tsx's new Widgets tab). A "widget" here is a self-contained
   read (and sometimes act) surface that already exists somewhere in the kiosk
   as a component or a hook — this file does not reimplement Home Assistant
   plumbing, Docker health, or vitals; it wraps what kiosk-hub.tsx,
   kiosk-display.tsx, kiosk-client.ts, kiosk-vitals.tsx, kiosk-timers.tsx and
   kiosk-doorbell.tsx already expose, the same "own-world, reuse the hook"
   idiom kiosk-climate.tsx documents for the modal it reuses from the tile.

   PERSISTENCE mirrors kiosk-theme.tsx's device-local-preference idiom exactly
   (localStorage + a window CustomEvent, no context provider): a per-tablet
   choice, defensively parsed so a corrupt or stale blob degrades to "ignore
   it" rather than throwing on a kiosk with nobody around to see an error
   overlay.

   HOOKS SAFETY: each widget's `render` returns a real JSX element
   (`<XyzWidget ... />`), never a bare function-call result inlined into the
   caller's own render body. That's what lets KIOSK_WIDGETS be reordered,
   added to, or removed from a layout at runtime without violating the Rules
   of Hooks — each widget is its own component instance as far as React is
   concerned, so hooks inside one are isolated from however many siblings
   come and go around it, the same guarantee `<KioskClimateTile />` gets from
   being mapped in a list rather than called as a plain function. */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Container, Newspaper, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";
import { KioskAssistant } from "@/components/kiosk-assistant";
import { KioskForecastRail } from "@/components/kiosk-forecast";
import { useKioskBriefing, useWeatherView, type KioskPeriod } from "@/components/kiosk-display";
import { useKioskHa } from "@/components/kiosk-hub";
import { useFreshness, useKioskHealth, useKioskVitals } from "@/lib/kiosk-client";
import { StaleTag } from "@/components/kiosk-stale-tag";
import { KioskVitals } from "@/components/kiosk-vitals";
import { KioskTimersButton } from "@/components/kiosk-timers";
import { KioskDoorbellButton, useDoorbellSnapshot } from "@/components/kiosk-doorbell";

/* ── registry types ──────────────────────────────────────────────────────── */

export type KioskWidgetId =
  | "forecast"
  | "assistant"
  | "news"
  | "briefing"
  | "weather-outlook"
  | "lights"
  | "scenes"
  | "climate"
  | "containers"
  | "vitals"
  | "timers"
  | "doorbell";

export type KioskScreen = "glance" | "full";

export interface KioskWidgetCtx {
  period: KioskPeriod;
  /** Threaded down to the doorbell widget only — every other widget ignores
   *  it. Kept on the shared ctx rather than a special-cased prop so callers
   *  (the carousel, FullContent) build one ctx object per render instead of
   *  a bespoke one per widget id. */
  onDoorbellClick: () => void;
  /** Set by the carousel only (kiosk-carousel.tsx) — a widget calls this with
   *  its own current emptiness so the carousel can drop that pane and its dot
   *  instead of leaving a swipeable blank page standing. `undefined` in every
   *  other context a widget renders in (full mode's plain vertical list),
   *  where an empty widget just collapses to a zero-height div on its own. */
  reportEmpty?: (empty: boolean) => void;
}

export interface KioskWidgetDef {
  id: KioskWidgetId;
  label: string;
  blurb: string;
  allow: readonly KioskScreen[];
  requires?: "ha" | "docker" | "weather" | "briefing";
  render: (ctx: KioskWidgetCtx) => ReactNode;
}

export interface KioskWidgetLayout {
  glance: KioskWidgetId[];
  full: KioskWidgetId[];
}

/* ── shared helpers ──────────────────────────────────────────────────────── */

/** Today's live digest failure reads verbatim as
 *  "Digest LLM run failed (no_result): empty completion (finish_reason: length)"
 *  — this is what stops that string (or any future variant carrying the same
 *  "no_result" marker) from being painted on the wall as if it were content. */
function isFailureText(s: string | null | undefined): boolean {
  if (!s) return false;
  return s.startsWith("Digest LLM run failed") || s.includes("no_result");
}

/** Reports a widget's own emptiness up through ctx.reportEmpty (a no-op
 *  outside the carousel — see KioskWidgetCtx's comment). Centralised so every
 *  widget calls it the same way rather than re-deriving the effect. */
function useEmptyReport(empty: boolean, reportEmpty?: (empty: boolean) => void) {
  useEffect(() => {
    reportEmpty?.(empty);
  }, [empty, reportEmpty]);
}

// Same button shape kiosk-glance.tsx's GlanceTiles used for its auto-picked
// tiles, lifted here as the shared visual for the lights/scenes widgets now
// that each is its own pane rather than a merged, capped pick.
const TILE_BASE =
  "min-h-16 min-w-32 max-w-48 rounded-tile border px-4 py-3 text-sm outline-none transition focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98]";
const TILE_ON = "border-accent/40 bg-accent/10 text-ink";
const TILE_OFF = "border-line bg-transparent text-ink-dim hover:border-line-bright hover:text-ink";

/** Mirrors kiosk-climate.tsx's own formatTemp — kept as its own copy rather
 *  than imported, same OWN-WORLD reasoning that file states for its own
 *  duplicated helpers: this is a read-only glance summary, not the tile's
 *  editing surface, and the two are allowed to drift. */
function formatTemp(v: number | null | undefined, unit: string | null | undefined): string {
  if (v == null) return "—";
  const unitTrimmed = (unit ?? "").trim();
  const degree = unitTrimmed.startsWith("°") ? "" : "°";
  return `${v.toFixed(1)}${degree}${unitTrimmed}`;
}

/* ── weather-outlook ─────────────────────────────────────────────────────── */
// Lifted verbatim from kiosk-glance.tsx's old weatherSentence — that file no
// longer owns this content directly, the widget does.
function weatherSentence(period: KioskPeriod, view: ReturnType<typeof useWeatherView>): string | null {
  const ok = view.ok;
  if (!ok) return view.status === "unreachable-empty" ? "weather unreachable" : null;
  const today = ok.days[0];
  const tomorrow = ok.days[1];
  if (period === "evening" && tomorrow) {
    return `tomorrow ${tomorrow.label.toLowerCase()} ${Math.round(tomorrow.maxC)}° · rain ${tomorrow.rainPct}%`;
  }
  if (!today) return null;
  return `high ${Math.round(today.maxC)}° low ${Math.round(today.minC)}° · rain ${today.rainPct}%`;
}

/* ── forecast (the band's default pane) ──────────────────────────────────── */

/* Renders the SAME KioskForecastRail full mode uses, at its glance type ramp.
   It is a widget here only so the band can rotate away from it and back; the
   rail itself is untouched, including the `px-1 -mx-1` pair that keeps the
   first and last day's rounded corners from being clipped. */
function ForecastWidget({ period, reportEmpty }: { period: KioskPeriod; reportEmpty?: (empty: boolean) => void }) {
  const weather = useWeatherView();
  const days = weather.ok?.days ?? [];
  useEmptyReport(days.length === 0, reportEmpty);
  if (days.length === 0) return null;
  // No onRadarClick: the radar button is full-view only (see
  // KioskForecastRail), so the glance band's rail is purely a reading.
  return (
    <div className="flex w-full items-center justify-center">
      <KioskForecastRail days={days} emphasizeIndex={period === "evening" ? 1 : null} size="glance" />
    </div>
  );
}

function WeatherOutlookWidget({ period, reportEmpty }: { period: KioskPeriod; reportEmpty?: (empty: boolean) => void }) {
  const weather = useWeatherView();
  const line = weatherSentence(period, weather);
  useEmptyReport(!line, reportEmpty);
  if (!line) return null;
  return <p className="max-w-xl text-center text-base text-ink-dim">{line}</p>;
}

/* ── briefing (digest headline + action) ─────────────────────────────────── */

function BriefingWidget({ period, reportEmpty }: { period: KioskPeriod; reportEmpty?: (empty: boolean) => void }) {
  // Same period gate the old inline block used (kiosk-glance.tsx: `period ===
  // "morning" && digest`) — passing it straight into useKioskBriefing's
  // `active` means the hook itself never fetches outside the morning window,
  // reproducing the old cost profile exactly rather than polling all day.
  const briefing = useKioskBriefing(period === "morning");
  const data = briefing.data;
  const digest = data?.status === "ok" ? data.digest : undefined;
  const empty = !digest || isFailureText(digest.headline);
  useEmptyReport(empty, reportEmpty);
  if (empty || !digest) return null;

  const attention = Boolean(digest.actionNeeded && digest.actionNeeded.toLowerCase() !== "no");
  return (
    <p className={cn("max-w-xl text-center text-base", attention ? "text-warn" : "text-ink-dim")}>
      briefing: {digest.headline.replace(/\.$/, "")}
      {attention && ` — ${digest.actionNeeded.replace(/^yes\s*[—-]?\s*/i, "")}`}
    </p>
  );
}

/* ── news ─────────────────────────────────────────────────────────────────── */

function NewsWidget({ reportEmpty }: { reportEmpty?: (empty: boolean) => void }) {
  /* Active ALL DAY, unlike the morning-briefing widget beside it. The news is
     the reason the band exists as far as the owner is concerned, and gating it
     on `period === "morning"` meant the pane silently vanished for twenty
     hours a day — measured: at ?period=afternoon the band came up with only
     three panes because this one reported itself empty.

     It costs one fetch, not a poll: useKioskBriefing's refreshInterval already
     returns 0 once a digest or news payload has arrived, and the server side
     is a daily cache. At night the band isn't rendered at all (the night
     overlay owns the screen), so this widget is unmounted and fetches
     nothing. */
  const briefing = useKioskBriefing(true);
  const data = briefing.data;
  const news = data?.status === "ok" ? data.news : undefined;

  const lines = useMemo(() => {
    if (!news) return [];
    const raw = news.summary
      ? news.summary.split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean)
      : news.headlines.slice(0, 4);
    // Suppress the failure-shaped line rather than the whole widget when it's
    // one line among several (a partial digest failure shouldn't hide real
    // headlines that did come back), and drop the widget entirely below when
    // nothing survives the filter.
    return raw.filter((l) => !isFailureText(l));
  }, [news]);

  const empty = lines.length === 0;
  useEmptyReport(empty, reportEmpty);
  if (empty || !news) return null;

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="flex items-center gap-2 text-ink-faint">
        <Newspaper size={13} aria-hidden />
        <span className="microlabel">News</span>
      </div>
      <ul className="space-y-1">
        {lines.map((line, i) => (
          <li key={i} className="max-w-xl text-sm text-ink-dim">
            {line}
          </li>
        ))}
      </ul>
      <div className="microlabel">{news.source}</div>
    </div>
  );
}

/* ── lights / scenes ─────────────────────────────────────────────────────── */
// Split out of the old GlanceTiles' merged, time-ordered, 4-tile-capped pick:
// each domain is now its own pane with room to show everything HA offers,
// rather than a shared cap fighting over four slots. The button shape and
// the stopPropagation opt-out (a control's own press must not also promote
// glance -> full underneath it) are both carried over unchanged.

function LightsWidget({ reportEmpty }: { reportEmpty?: (empty: boolean) => void }) {
  const ha = useKioskHa();
  const entities = ha.data?.status === "ok" ? ha.data.entities : null;
  const lights = useMemo(() => entities?.lights.filter((l) => l.available) ?? [], [entities]);
  useEmptyReport(lights.length === 0, reportEmpty);
  if (lights.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {lights.map((l) => {
        const pending = ha.isPending(l.entityId);
        return (
          <button
            key={l.entityId}
            type="button"
            disabled={pending}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void ha.runAction({ entityId: l.entityId, action: "toggle" });
            }}
            className={cn(TILE_BASE, l.on ? TILE_ON : TILE_OFF, pending && "opacity-60")}
          >
            <span className="block truncate">{l.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function ScenesWidget({ reportEmpty }: { reportEmpty?: (empty: boolean) => void }) {
  const ha = useKioskHa();
  const entities = ha.data?.status === "ok" ? ha.data.entities : null;
  const scenes = useMemo(() => entities?.scenes.filter((s) => s.available) ?? [], [entities]);
  useEmptyReport(scenes.length === 0, reportEmpty);
  if (scenes.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {scenes.map((s) => {
        const pending = ha.isPending(s.entityId);
        return (
          <button
            key={s.entityId}
            type="button"
            disabled={pending}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void ha.runAction({ entityId: s.entityId, action: "activate_scene" });
            }}
            className={cn(TILE_BASE, TILE_OFF)}
          >
            <span className="block truncate">{s.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── climate (glance-only compact summary) ──────────────────────────────── */
// Deliberately NOT the full <KioskClimateTile/> (kiosk-hub.tsx's ClimateSection
// already renders those inside full's fixed KioskHub section — a second copy
// here would double-render the same controls). Glance gets a quiet read-only
// line instead; full mode's climate stays exactly as it is today, unowned by
// the widget system, per the allow list below.
function ClimateGlanceWidget({ reportEmpty }: { reportEmpty?: (empty: boolean) => void }) {
  const ha = useKioskHa();
  const entities = ha.data?.status === "ok" ? ha.data.entities : null;
  const climates = entities?.climates ?? [];
  useEmptyReport(climates.length === 0, reportEmpty);
  if (climates.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-2 text-ink-faint">
        <Thermometer size={13} aria-hidden />
        <span className="microlabel">Climate</span>
      </div>
      {climates.map((c) => {
        const target = c.targetTemp ?? c.targetTempLow;
        return (
          <div key={c.entityId} className="flex items-center gap-2 font-mono text-sm">
            <span className="text-ink">{c.name}</span>
            <span className="text-ink-dim">
              {formatTemp(c.currentTemp, c.unit)}
              {target != null && ` → ${formatTemp(target, c.unit)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── containers (Docker health) ──────────────────────────────────────────── */

function ContainersWidget({ reportEmpty }: { reportEmpty?: (empty: boolean) => void }) {
  const health = useFreshness(useKioskHealth(15_000));
  useEmptyReport(!health.data, reportEmpty);
  if (!health.data) return null;

  const problem = health.data.unhealthy + health.data.dead + health.data.stopped;
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 font-mono text-sm">
      <span className="flex items-center gap-1.5 text-ink-dim">
        <Container size={13} className="text-ink-faint" aria-hidden />
        <span className="dot dot-running" aria-hidden />
        {health.data.running} running
      </span>
      {problem > 0 && (
        <span className="flex items-center gap-1.5 text-warn">
          <span className="dot dot-unhealthy" aria-hidden />
          {problem} need attention
        </span>
      )}
      {health.status === "ready-stale" && <StaleTag />}
    </div>
  );
}

/* ── vitals (host CPU/RAM/disk/net) ──────────────────────────────────────── */
// Reuses <KioskVitals/> wholesale (per the spec: it already renders its own
// loading/error states) — this wrapper only tracks emptiness for the carousel
// via the same public /kiosk/api/vitals hook the component itself calls, so
// the pane can be dropped when there is genuinely nothing to show yet, rather
// than second-guessing KioskVitals' own render.
function VitalsWidget({ reportEmpty }: { reportEmpty?: (empty: boolean) => void }) {
  const { data, error } = useKioskVitals(5000);
  useEmptyReport(!data && !error, reportEmpty);
  return (
    <div className="flex justify-center">
      <KioskVitals />
    </div>
  );
}

/* ── timers / doorbell ───────────────────────────────────────────────────── */
// Both reuse the existing entry affordance verbatim. Note these are NOT part
// of DEFAULT_WIDGET_LAYOUT — kiosk-glance.tsx keeps its own always-visible
// fixed-corner KioskTimersButton and the Admin button exactly as they are
// today (untouched by this widget system), so a device that never opens the
// Widgets tab never loses the "timer button is always there" guarantee. These
// registry entries exist so someone WHO WANTS a bigger, in-rotation timers or
// doorbell pane can add one deliberately.
function TimersWidget() {
  return (
    // Opt-out from the root promoter, same idiom as kiosk-glance.tsx's own
    // fixed button wrapper: a tap on this control must not also promote
    // glance -> full underneath it.
    <div
      className="flex justify-center"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <KioskTimersButton className="h-14" />
    </div>
  );
}

function DoorbellWidget({ onDoorbellClick, reportEmpty }: { onDoorbellClick: () => void; reportEmpty?: (empty: boolean) => void }) {
  // KioskDoorbellButton already hides itself when HA has no door camera to
  // offer (see that file's own comment) — mirrored here via the same
  // useDoorbellSnapshot read so the carousel can drop the pane instead of
  // presenting an empty one.
  const { data } = useDoorbellSnapshot();
  useEmptyReport(!data?.cameras.length, reportEmpty);
  return (
    <div className="flex justify-center">
      <KioskDoorbellButton onClick={onDoorbellClick} />
    </div>
  );
}

/* ── the registry ────────────────────────────────────────────────────────── */

export const KIOSK_WIDGETS: readonly KioskWidgetDef[] = [
  {
    id: "forecast",
    label: "5-day forecast",
    blurb: "The week ahead — the band's default face.",
    // Band-only. In FULL mode the forecast rail is rendered directly by
    // kiosk-surface.tsx as one of the four shared FLIP nodes, so offering it
    // as a full-mode widget too would put two rails on the same screen.
    allow: ["glance"],
    requires: "weather",
    render: (ctx) => <ForecastWidget period={ctx.period} reportEmpty={ctx.reportEmpty} />,
  },
  {
    id: "assistant",
    label: "Assistant",
    blurb: "Ask a question or control the house in plain words.",
    allow: ["glance", "full"],
    // No `requires`: the assistant is useful even when Home Assistant is
    // unreachable (open questions still route to hermes), so gating it on a
    // data source would hide it exactly when it might explain the outage.
    // It never reports itself empty — an input field with nothing typed in
    // it is not an empty pane, it is a ready one.
    render: (ctx) => <KioskAssistant onShowCamera={ctx.onDoorbellClick} />,
  },
  {
    id: "weather-outlook",
    label: "Weather outlook",
    blurb: "Today's high/low and rain chance (tomorrow's, in the evening).",
    allow: ["glance", "full"],
    requires: "weather",
    render: (ctx) => <WeatherOutlookWidget period={ctx.period} reportEmpty={ctx.reportEmpty} />,
  },
  {
    id: "briefing",
    label: "Morning briefing",
    blurb: "The generated digest headline and anything it flags as needing attention.",
    allow: ["glance", "full"],
    requires: "briefing",
    render: (ctx) => <BriefingWidget period={ctx.period} reportEmpty={ctx.reportEmpty} />,
  },
  {
    id: "news",
    label: "News",
    blurb: "Today's headlines, from the generated digest. Shown all day.",
    allow: ["glance", "full"],
    requires: "briefing",
    render: (ctx) => <NewsWidget reportEmpty={ctx.reportEmpty} />,
  },
  {
    id: "lights",
    label: "Lights",
    blurb: "Every available Home Assistant light, as tap-to-toggle tiles.",
    allow: ["glance", "full"],
    requires: "ha",
    render: (ctx) => <LightsWidget reportEmpty={ctx.reportEmpty} />,
  },
  {
    id: "scenes",
    label: "Scenes",
    blurb: "Every available Home Assistant scene, as tap-to-activate tiles.",
    allow: ["glance", "full"],
    requires: "ha",
    render: (ctx) => <ScenesWidget reportEmpty={ctx.reportEmpty} />,
  },
  {
    id: "climate",
    label: "Climate (compact)",
    blurb: "A read-only room · current → target line per climate entity.",
    // Full mode's climate stays the existing KioskHub tiles (unowned by
    // widgets) — see ClimateGlanceWidget's comment for why this is glance-only.
    allow: ["glance"],
    requires: "ha",
    render: (ctx) => <ClimateGlanceWidget reportEmpty={ctx.reportEmpty} />,
  },
  {
    id: "containers",
    label: "Containers",
    blurb: "Running count, plus anything unhealthy or stopped.",
    allow: ["glance", "full"],
    requires: "docker",
    render: (ctx) => <ContainersWidget reportEmpty={ctx.reportEmpty} />,
  },
  {
    id: "vitals",
    label: "Host vitals",
    blurb: "CPU, memory, disk and network for the server itself.",
    allow: ["glance", "full"],
    render: (ctx) => <VitalsWidget reportEmpty={ctx.reportEmpty} />,
  },
  {
    id: "timers",
    label: "Timers",
    blurb: "The kitchen timers button — glance already shows this in its corner by default.",
    allow: ["glance", "full"],
    render: () => <TimersWidget />,
  },
  {
    id: "doorbell",
    label: "Front door",
    blurb: "Opens the front-door camera. Full mode already has this in its header.",
    allow: ["glance", "full"],
    requires: "ha",
    render: (ctx) => <DoorbellWidget onDoorbellClick={ctx.onDoorbellClick} reportEmpty={ctx.reportEmpty} />,
  },
];

export const KIOSK_WIDGET_MAP: ReadonlyMap<KioskWidgetId, KioskWidgetDef> = new Map(
  KIOSK_WIDGETS.map((w) => [w.id, w]),
);

/** Reproduces today's glance content exactly (weather sentence, the morning
 *  briefing digest line, and the lights/scenes tiles GlanceTiles used to pick
 *  from) — see kiosk-widgets.tsx's THESIS and the carousel's own THESIS for
 *  why `news`/`containers`/`vitals`/etc. are shipped as available widgets but
 *  NOT defaulted on: an untouched device must look unchanged after this
 *  lands, and the new content is one visit to the Widgets tab away. Full's
 *  default is empty — KioskDisplay + KioskHub already show everything full
 *  mode showed before this feature existed, unmanaged by widgets (see
 *  FullContent in kiosk-surface.tsx). */
export const DEFAULT_WIDGET_LAYOUT: KioskWidgetLayout = {
  glance: ["forecast", "news", "climate", "containers"],
  full: [],
};

/* ── persistence (mirrors kiosk-theme.tsx's setKioskTheme/useKioskTheme) ──── */

const STORAGE_KEY = "kiosk-widgets";
const CHANGE_EVENT = "kiosk-widgets-change";

function isKioskWidgetId(v: unknown): v is KioskWidgetId {
  return typeof v === "string" && KIOSK_WIDGET_MAP.has(v as KioskWidgetId);
}

/** Defensive parse: an unknown id is dropped (not kept, not substituted); a
 *  registry widget simply absent from a stored list stays absent — the user
 *  chose to remove it, so this must never re-append it. Any shape that isn't
 *  recognisably `{ glance: string[], full: string[] }` returns null so the
 *  caller falls back to DEFAULT_WIDGET_LAYOUT wholesale rather than mixing a
 *  half-valid parse with defaults field-by-field. */
function sanitizeLayout(raw: unknown): KioskWidgetLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.glance) || !Array.isArray(obj.full)) return null;
  return {
    glance: obj.glance.filter(isKioskWidgetId),
    full: obj.full.filter(isKioskWidgetId),
  };
}

function readStoredLayout(): KioskWidgetLayout | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeLayout(JSON.parse(raw));
  } catch {
    // Corrupt payload / private mode — treat exactly like "nothing stored".
    return null;
  }
}

function persistAndBroadcast(layout: KioskWidgetLayout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // non-persistent is fine, same as setKioskTheme
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: layout }));
}

/** Replaces one screen's ordered id list, leaving the other screen's list (in
 *  whatever storage already has, or the default) untouched. Callers pass the
 *  full new order for that screen — reordering, adding, and removing are all
 *  "compute the new array, call this once" from the Widgets tab's own state. */
export function setKioskWidgetLayout(screen: KioskScreen, ids: KioskWidgetId[]): void {
  const current = readStoredLayout() ?? DEFAULT_WIDGET_LAYOUT;
  persistAndBroadcast({ ...current, [screen]: ids });
}

export function resetKioskWidgetLayout(): void {
  persistAndBroadcast(DEFAULT_WIDGET_LAYOUT);
}

/** SSR-safe seed (DEFAULT_WIDGET_LAYOUT, same as every stored-preference hook
 *  in this app), then the real stored layout once mounted; live-updates on
 *  setKioskWidgetLayout/resetKioskWidgetLayout from anywhere (the Widgets tab
 *  and the carousel/FullContent consuming it have no shared ancestor worth a
 *  context provider, same reasoning as useKioskTheme). */
export function useKioskWidgetLayout(): KioskWidgetLayout {
  const [layout, setLayout] = useState<KioskWidgetLayout>(DEFAULT_WIDGET_LAYOUT);

  useEffect(() => {
    const stored = readStoredLayout();
    if (stored) setLayout(stored);
    const onChange = (e: Event) => {
      const sanitized = sanitizeLayout((e as CustomEvent).detail as unknown);
      if (sanitized) setLayout(sanitized);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  return layout;
}

/* ── availability (for the picker's "unavailable" marks) ─────────────────── */

export type KioskWidgetRequirement = NonNullable<KioskWidgetDef["requires"]>;

/** Whether each `requires` kind is configured on this deployment — NOT whether
 *  it's currently reachable (a wifi blip shouldn't gray out a widget the
 *  owner clearly has configured). Only mounted while the Widgets tab is open
 *  (kiosk-appearance.tsx), so these extra reads don't run for every elevated
 *  session, only while someone is actually looking at the picker; SWR still
 *  dedupes them against the same keys KioskHub/KioskDisplay already poll. */
export function useKioskWidgetAvailability(): Record<KioskWidgetRequirement, boolean> {
  const ha = useKioskHa();
  const weather = useWeatherView();
  const briefing = useKioskBriefing(true);
  const health = useKioskHealth(15_000);

  return useMemo(
    () => ({
      ha: ha.data?.status !== "unconfigured",
      weather: weather.status !== "unconfigured",
      briefing: briefing.data?.status !== "unconfigured" && briefing.data?.status !== "unavailable",
      // No "unconfigured" concept surfaces from /kiosk/api/health today — a
      // missing/errored read just means "can't reach it right now", not "this
      // owner never set up Docker", so this stays true unconditionally.
      docker: true,
    }),
    [ha.data?.status, weather.status, briefing.data?.status, health.error],
  );
}

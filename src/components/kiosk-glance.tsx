"use client";

/* THESIS: the "Glance Board" kiosk layout — a wall clock that happens to
   know things. Distance-first: the clock and temperature are the only
   large elements (legible from across a room), everything else is one or
   two quiet sentences plus a single row of four auto-picked control tiles.
   OWN-WORLD, inverted: where the standard layout is hairline panels, this
   surface is deliberately OPEN GROUND — no .panel boxes at all; type and
   spacing carry the whole composition, and the one accent hue only appears
   on live state (a tile that's on) or a real problem (dead/unhealthy
   containers, digest action line). That inversion is the point: on a
   surface this quiet, the single warn line is unmissable.

   Night is NOT handled here — page.tsx's KioskNightOverlay owns 22:00–05:00
   for both layouts (glance at night ≈ the overlay anyway; one night, not
   two). Elevation also isn't: an elevated kiosk always shows the standard
   layout, because admin work needs the hub and panels. */

import { useMemo } from "react";
import { fetcher } from "@/lib/client";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { KioskClock } from "@/components/kiosk-clock";
import {
  useWeatherView,
  useKioskBriefing,
  WEATHER_ICON,
  type KioskPeriod,
} from "@/components/kiosk-display";
import { useKioskHa } from "@/components/kiosk-hub";

interface KioskHealthCounts {
  running: number;
  dead: number;
  unhealthy: number;
}

/** Same /kiosk/api/health source the status strip polls, at a lazier cadence —
 *  the glance board reports a sentence, not a live readout. */
function useGlanceHealth() {
  return useSWR<KioskHealthCounts>("/kiosk/api/health", fetcher, { refreshInterval: 15_000 });
}

/* ── the two quiet sentences ────────────────────────────────────────────── */

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

function ServerSentence() {
  const { data: health, error } = useGlanceHealth();
  if (error && !health) return <span className="text-ink-faint">server status unreachable</span>;
  if (!health) return <span className="text-ink-faint"> </span>;
  const bad = health.dead > 0;
  const warn = health.unhealthy > 0;
  if (bad || warn) {
    return (
      <span className={bad ? "text-bad" : "text-warn"}>
        {health.dead > 0 && `${health.dead} dead`}
        {health.dead > 0 && health.unhealthy > 0 && " · "}
        {health.unhealthy > 0 && `${health.unhealthy} unhealthy`}
        {" — check dashboard"}
      </span>
    );
  }
  return (
    <span>
      server quiet · <span className="font-mono tabular-nums">{health.running}</span> running
    </span>
  );
}

/* ── auto-picked control tiles ──────────────────────────────────────────── */

const TILE_COUNT = 4;

/** Four entities chosen by time of day: evenings reach for scenes first
 *  (movie night, wind-down), mornings/days for lights. Deterministic — same
 *  hour, same four tiles — so the wall display never reshuffles underfoot. */
function GlanceTiles({ period }: { period: KioskPeriod }) {
  const ha = useKioskHa();
  const entities = ha.data?.status === "ok" ? ha.data.entities : null;

  const picks = useMemo(() => {
    if (!entities) return [];
    const scenes = entities.scenes
      .filter((s) => s.available)
      .map((s) => ({ key: s.entityId, name: s.name, kind: "scene" as const, on: false }));
    const lights = entities.lights
      .filter((l) => l.available)
      .map((l) => ({ key: l.entityId, name: l.name, kind: "light" as const, on: l.on }));
    const switches = entities.switches
      .filter((s) => s.available)
      .map((s) => ({ key: s.entityId, name: s.name, kind: "switch" as const, on: s.on }));
    const ordered = period === "evening" ? [...scenes, ...lights, ...switches] : [...lights, ...scenes, ...switches];
    return ordered.slice(0, TILE_COUNT);
  }, [entities, period]);

  // HA not connected (or nothing usable): render nothing. The standard
  // layout owns the explanatory empty state — a wall clock doesn't nag.
  if (picks.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {picks.map((p) => {
        const pending = ha.isPending(p.key);
        return (
          <button
            key={p.key}
            type="button"
            disabled={pending}
            onClick={() => {
              if (p.kind === "scene") {
                void ha.runAction({ entityId: p.key, action: "activate_scene" });
              } else {
                void ha.runAction({ entityId: p.key, action: "toggle" });
              }
            }}
            className={cn(
              "min-h-[64px] min-w-[128px] rounded-lg border px-4 py-3 text-sm outline-none transition focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.97]",
              p.on
                ? "border-accent/40 bg-accent/10 text-ink"
                : "border-line bg-transparent text-ink-dim hover:border-line-bright hover:text-ink",
              pending && "opacity-60",
            )}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

/* ── the board ──────────────────────────────────────────────────────────── */

export function KioskGlance({
  period,
  onAdminClick,
}: {
  period: KioskPeriod;
  onAdminClick: () => void;
}) {
  const weather = useWeatherView();
  const briefing = useKioskBriefing(period === "morning");
  const current = weather.ok?.current ?? null;
  const Icon = current ? WEATHER_ICON[current.code] : null;

  const wLine = weatherSentence(period, weather);
  const digest = briefing.data?.status === "ok" ? briefing.data.digest : undefined;
  const digestAttention = Boolean(digest && digest.actionNeeded && digest.actionNeeded.toLowerCase() !== "no");

  return (
    <div className="flex min-h-[calc(100vh-2rem)] flex-col items-center justify-center gap-10 px-6 text-center">
      <div className="flex flex-col items-center gap-5">
        <KioskClock />

        {current && (
          <div className="flex items-center gap-3 text-ink">
            {Icon && <Icon size={26} className="text-ink-dim" aria-hidden />}
            <span className="font-mono tabular-nums text-3xl">{Math.round(current.tempC)}°</span>
            <span className="text-xl text-ink-dim">{current.label.toLowerCase()}</span>
            {weather.status === "ready-stale" && <span className="microlabel !text-warn">stale</span>}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-2 text-base text-ink-dim">
        {wLine && <p>{wLine}</p>}
        <p>
          <ServerSentence />
        </p>
        {period === "morning" && digest && (
          <p className={cn("max-w-xl", digestAttention ? "text-warn" : "text-ink-dim")}>
            briefing: {digest.headline.replace(/\.$/, "")}
            {digestAttention && ` — ${digest.actionNeeded.replace(/^yes\s*[—-]?\s*/i, "")}`}
          </p>
        )}
      </div>

      <GlanceTiles period={period} />

      <button
        type="button"
        onClick={onAdminClick}
        className="fixed bottom-4 right-5 h-11 px-4 rounded-md text-xs text-ink-faint outline-none transition hover:text-ink hover:bg-panel-2 focus-visible:ring-1 focus-visible:ring-accent"
      >
        Admin
      </button>
    </div>
  );
}

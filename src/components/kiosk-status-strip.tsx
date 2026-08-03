"use client";

/* THESIS: the hub's home-first redesign demotes server health from the whole
   screen (the old ambient wall display) to one always-visible line at the
   top — a glance, not a report. It stays compact at every width by dropping
   secondary detail (date, cpu/mem, the "nightwatch · ambient" wordmark)
   before it ever drops the thing that actually needs attention: the alert
   chip only shows up on a real threshold (dead/unhealthy containers or the
   metrics feed itself going dark) and never gets squeezed out. OWN-WORLD:
   same hairline .panel / mono / microlabel vocabulary as the rest of
   nightwatch — composed fresh here rather than importing KioskClock (sized
   for a wall, not a strip) or KioskVitals/KioskHealth (full panels), per the
   redesign brief; sourced from the same /kiosk/api/vitals + /kiosk/api/health
   routes those components use. */

import { Activity, ShieldAlert } from "lucide-react";
import { useFreshness, useKioskHealth, useKioskVitals } from "@/lib/kiosk-client";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { KioskTimersButton } from "@/components/kiosk-timers";
import { StaleTag } from "@/components/kiosk-stale-tag";

const TIME_FMT = new Intl.DateTimeFormat("en-AU", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const DATE_FMT = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

export function KioskStatusStrip({
  elevated,
  onAdminClick,
}: {
  elevated: boolean;
  onAdminClick: () => void;
}) {
  const now = useNow(true);
  const date = now === 0 ? null : new Date(now);

  // 15s, not 5s: this strip runs for weeks at a time and shows ambient
  // container counts and host vitals, not a live console — kiosk-glance.tsx
  // already polls health at this cadence with no observed staleness
  // complaint. Cuts this component from 24 req/min to 8 req/min combined.
  // useFreshness's stale marking is orthogonal to cadence — it reacts to
  // SWR's error/data state, not to how often a request fires.
  const vitals = useFreshness(useKioskVitals(15_000));
  const health = useFreshness(useKioskHealth(15_000));

  const dead = health.data?.dead ?? 0;
  const unhealthy = health.data?.unhealthy ?? 0;
  const severity = dead > 0 ? "bad" : unhealthy > 0 ? "warn" : null;

  return (
    <div className="panel sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 md:py-3">
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono tabular-nums leading-none text-ink text-lg md:text-xl">
          {date ? TIME_FMT.format(date) : "--:--:--"}
        </span>
        <span className="hidden text-2xs text-ink-dim sm:inline">
          {date ? DATE_FMT.format(date) : ""}
        </span>
      </div>

      <div className="hidden items-center gap-1.5 md:flex">
        <Activity size={12} className="text-accent" aria-hidden />
        <span className="microlabel">nightwatch · ambient</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
        {vitals.status === "unreachable-empty" ? (
          // No `hidden` here (unlike the cpu/mem readout below): a data
          // source going dark is a real signal, not decoration, and must
          // survive down to 390px the same way the severity chip does —
          // only the wording compresses at the phone breakpoint.
          <div className="flex items-center gap-1.5 font-mono text-xs text-bad">
            <ShieldAlert size={12} aria-hidden />
            <span className="hidden sm:inline">vitals unreachable</span>
            <span className="sm:hidden">vitals down</span>
          </div>
        ) : (
          vitals.data && (
            <div className="hidden items-center gap-2 font-mono text-xs text-ink-dim sm:flex">
              <span>
                cpu <span className="text-ink">{Math.round(vitals.data.cpu.percent)}%</span>
              </span>
              <span>
                mem <span className="text-ink">{Math.round(vitals.data.memory.percent)}%</span>
              </span>
              {vitals.status === "ready-stale" && <StaleTag />}
            </div>
          )
        )}

        {health.status === "unreachable-empty" ? (
          <div className="flex items-center gap-1.5 font-mono text-xs text-bad">
            <ShieldAlert size={13} aria-hidden />
            container health unreachable
          </div>
        ) : (
          <div className="flex items-center gap-1.5 font-mono text-xs text-ink-dim">
            <span className="dot dot-running" aria-hidden />
            {health.data ? health.data.running : "…"}
            <span className="microlabel">running</span>
            {health.status === "ready-stale" && <StaleTag />}
          </div>
        )}

        {severity && (
          <div
            role="status"
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs",
              severity === "bad" ? "border-bad/40 bg-bad/5 text-bad" : "border-warn/40 bg-warn/5 text-warn",
            )}
          >
            <ShieldAlert size={13} aria-hidden />
            {dead > 0 && <span>{dead} dead</span>}
            {dead > 0 && unhealthy > 0 && <span aria-hidden="true">·</span>}
            {unhealthy > 0 && <span>{unhealthy} unhealthy</span>}
            {health.status === "ready-stale" && <StaleTag />}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <KioskTimersButton />
        {elevated ? (
          <span className="flex items-center gap-1.5 font-mono text-xs text-accent">
            <span className="dot dot-live" aria-hidden />
            elevated
          </span>
        ) : (
          <button
            type="button"
            onClick={onAdminClick}
            className="h-11 px-4 rounded-md text-ink-dim hover:text-ink hover:bg-panel-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Admin
          </button>
        )}
      </div>
    </div>
  );
}

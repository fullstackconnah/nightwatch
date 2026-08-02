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
import { useKioskHealth, useKioskVitals } from "@/lib/kiosk-client";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

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

  const { data: vitals, error: vitalsError } = useKioskVitals(5000);
  const { data: health, error: healthError } = useKioskHealth(5000);

  const dead = health?.dead ?? 0;
  const unhealthy = health?.unhealthy ?? 0;
  const severity = dead > 0 ? "bad" : unhealthy > 0 ? "warn" : null;
  const metricsDown = Boolean(vitalsError) && Boolean(healthError);

  return (
    <div className="panel sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 md:py-3">
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono tabular-nums leading-none text-ink text-lg md:text-xl">
          {date ? TIME_FMT.format(date) : "--:--:--"}
        </span>
        <span className="hidden text-[0.7rem] text-ink-dim sm:inline">
          {date ? DATE_FMT.format(date) : ""}
        </span>
      </div>

      <div className="hidden items-center gap-1.5 md:flex">
        <Activity size={12} className="text-accent" aria-hidden />
        <span className="microlabel">nightwatch · ambient</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
        {metricsDown ? (
          <div className="flex items-center gap-1.5 font-mono text-xs text-bad">
            <ShieldAlert size={13} aria-hidden />
            host metrics unreachable
          </div>
        ) : (
          <>
            {vitals && (
              <div className="hidden items-center gap-3 font-mono text-xs text-ink-dim sm:flex">
                <span>
                  cpu <span className="text-ink">{Math.round(vitals.cpu.percent)}%</span>
                </span>
                <span>
                  mem <span className="text-ink">{Math.round(vitals.memory.percent)}%</span>
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 font-mono text-xs text-ink-dim">
              <span className="dot dot-running" aria-hidden />
              {health ? health.running : "…"}
              <span className="microlabel">running</span>
            </div>
          </>
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
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
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

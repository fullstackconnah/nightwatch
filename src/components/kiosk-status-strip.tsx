"use client";

/* THESIS: the merged surface (redesign-06 §5) folds this panel's job into
   kiosk-surface.tsx's shared header — the header now owns the outer
   `.panel sticky` shell, the clock (shared FLIP id "clock") and the
   health/running-count reading (shared FLIP id "server-line", since a
   glance⇄full transition has to move the SAME DOM node, not remount an
   equivalent one — see that file's structural-rule comment). What's left
   here is exactly the content that only ever exists in full mode and never
   travels: host vitals, the timers button, and admin/elevated. The
   dead/unhealthy severity chip that used to live here is gone outright —
   src/lib/attention.ts already probes both conditions and kiosk-alerts.tsx
   now owns that signal end to end (takeover + badge + tray), so a second,
   quieter announcement of the same fact here would just be a duplicate.
   Same hooks, same 15s cadence, same non-happy states as the strip this
   replaces.

   Wordmark removed and vitals gated behind `elevated` (redesign-06
   follow-up, 2026-08-03) — see the render below for why. */

import { ShieldAlert } from "lucide-react";
import { useFreshness, useKioskVitals } from "@/lib/kiosk-client";
import { cn } from "@/lib/utils";
import { KioskTimersButton } from "@/components/kiosk-timers";
import { StaleTag } from "@/components/kiosk-stale-tag";
import { KIOSK_EASE_OUT } from "@/lib/kiosk-motion";

export function KioskStatusStripExtras({
  elevated,
  onAdminClick,
  revealed,
  durationMs,
}: {
  elevated: boolean;
  onAdminClick: () => void;
  /** Drives the redesign's "fades in after the shared elements land" beat
   *  for this non-shared content (kiosk-surface.tsx computes the timing) —
   *  starts at opacity-0 and is flipped true once the header's FLIP travel
   *  has finished. */
  revealed: boolean;
  durationMs: number;
}) {
  // 15s, not 5s: this strip runs for weeks at a time and shows ambient host
  // vitals, not a live console — the shared header's health poll (running
  // count / unreachable) already runs at this cadence with no observed
  // staleness complaint. Vitals is the only fetch left in this file now
  // that the health reading itself moved to the shared server-line node.
  const vitals = useFreshness(useKioskVitals(15_000));

  // A ≤60ms-per-item stagger across the three groups below (contract's list
  // rule, ≤5 items) — each group gets its own transitionDelay so they don't
  // all pop in on the same frame once `revealed` flips.
  const revealClass = cn("transition-opacity motion-reduce:transition-none", revealed ? "opacity-100" : "opacity-0");
  const revealStyle = (i: number) => ({
    transitionDuration: `${durationMs}ms`,
    transitionTimingFunction: KIOSK_EASE_OUT,
    transitionDelay: revealed ? `${i * 40}ms` : "0ms",
  });

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* The "nightwatch · ambient" wordmark is gone (redesign-06 follow-up,
          2026-08-03): distance-read space on a wall panel goes to the
          owner's data, not the software's own name. Host vitals move behind
          `elevated` for the same reason — genuinely useful to the owner, but
          cpu/mem readings make the resting panel read as a monitoring
          console rather than a house. The running-count and unreachable/
          stale states live in kiosk-surface.tsx's ServerLine and are
          unaffected — they stay ambient in both modes. */}
      {elevated && (
        <div className={revealClass} style={revealStyle(0)}>
          {vitals.status === "unreachable-empty" ? (
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
        </div>
      )}

      <div className={cn("flex shrink-0 items-center gap-2", revealClass)} style={revealStyle(1)}>
        <KioskTimersButton />
        {elevated ? (
          <span className="flex items-center gap-1.5 font-mono text-xs text-accent">
            {/* `dot-live` is excluded from the breathe on purpose: it's an
                accent LIVENESS mark, not one of the container-state dots
                DESIGN.md reserves pulsing for (unhealthy/restarting), but a
                dot that pulses AND a caption that pulses beside it would be
                two clocks ticking out of phase. One motion per fact — the
                word carries it. */}
            <span className="dot dot-live" aria-hidden />
            <span className="kiosk-breathe">elevated</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={onAdminClick}
            className="h-11 px-4 rounded-md text-ink-dim hover:text-ink hover:bg-panel-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-accent kiosk-press"
          >
            Admin
          </button>
        )}
      </div>
    </div>
  );
}

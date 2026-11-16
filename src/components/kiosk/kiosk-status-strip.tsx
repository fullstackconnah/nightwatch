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

import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { useFreshness, useKioskVitals } from "@/lib/kiosk-client";
import { useKioskPollInterval } from "@/lib/kiosk-activity";
import { cn } from "@/lib/utils";
import { KioskTimersButton } from "@/components/kiosk/kiosk-timers";
import { StaleTag } from "@/components/kiosk/kiosk-stale-tag";
import { KIOSK_EASE_OUT } from "@/lib/kiosk-motion";

export function KioskStatusStripExtras({
  elevated,
  onAdminClick,
  revealed,
  durationMs,
  middle,
}: {
  elevated: boolean;
  /** Rect param lets the tapped Admin button feed the PIN pad's container-
   *  transform origin (kiosk-motion.ts's containerExpand) — see page.tsx's
   *  openPinPad. */
  onAdminClick: (rect?: DOMRect) => void;
  /** Drives the redesign's "fades in after the shared elements land" beat
   *  for this non-shared content (kiosk-surface.tsx computes the timing) —
   *  starts at opacity-0 and is flipped true once the header's FLIP travel
   *  has finished. */
  revealed: boolean;
  durationMs: number;
  /** Dock buttons that sit between Timers and Admin (kiosk-surface.tsx owns them). */
  middle?: ReactNode;
}) {
  // 15s, not 5s: this strip runs for weeks at a time and shows ambient host
  // vitals, not a live console — the shared header's health poll (running
  // count / unreachable) already runs at this cadence with no observed
  // staleness complaint. Vitals is the only fetch left in this file now
  // that the health reading itself moved to the shared server-line node.
  //
  // Backed off further once the screen goes idle and further again overnight
  // (kiosk-activity.ts's tiers, the ones kiosk-hub already used). This is a
  // textbook AMBIENT poll: the numbers are for glancing at, so a reading a
  // minute old on a screen nobody is standing in front of costs nothing, and
  // a wall tablet spends most of its life in exactly that state.
  const pollMs = useKioskPollInterval({ active: 15_000, idle: 60_000, night: 300_000 });
  const vitals = useFreshness(useKioskVitals(pollMs));

  // A ≤60ms-per-item stagger across the three groups below (contract's list
  // rule, ≤5 items) — each group gets its own transitionDelay so they don't
  // all pop in on the same frame once `revealed` flips.
  const revealClass = cn("transition-opacity motion-reduce:transition-none", revealed ? "opacity-100" : "opacity-0");
  const revealStyle = (i: number) => ({
    transitionDuration: `${durationMs}ms`,
    transitionTimingFunction: KIOSK_EASE_OUT,
    transitionDelay: revealed ? `${i * 40}ms` : "0ms",
  });

  // The dock's own order (brief 2.3): Timers first, so it keeps Glance's bottom-left spot; the caller's
  // `middle` (Shopping, Front door, Glance) next; then Admin, or the elevated mark with the host vitals.
  return (
    <>
      <div className={cn("shrink-0", revealClass)} style={revealStyle(0)}>
        <KioskTimersButton className="h-14 min-w-14" />
      </div>
      <div className={cn("flex items-center gap-3", revealClass)} style={revealStyle(1)}>
        {middle}
      </div>
      <div className={cn("flex shrink-0 items-center gap-3", revealClass)} style={revealStyle(2)}>
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
            data-sr-admin
            onClick={(e) => onAdminClick(e.currentTarget.getBoundingClientRect())}
            className="h-14 px-4 rounded-md text-ink-dim hover:text-ink hover:bg-panel-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-accent kiosk-press"
          >
            Admin
          </button>
        )}
        {elevated && (
          <div>
            {vitals.status === "unreachable-empty" ? (
              <div className="flex items-center gap-1.5 font-mono text-xs text-bad" data-sr-tone="bad">
                <ShieldAlert size={12} aria-hidden />
                <span className="hidden sm:inline">vitals unreachable</span>
                <span className="sm:hidden">vitals down</span>
              </div>
            ) : (
              vitals.data && (
                <div className="hidden items-center gap-2 font-mono text-xs text-ink-dim sm:flex">
                  <span>
                    cpu <span className="text-ink" data-sr-live>{Math.round(vitals.data.cpu.percent)}%</span>
                  </span>
                  <span>
                    mem <span className="text-ink" data-sr-live>{Math.round(vitals.data.memory.percent)}%</span>
                  </span>
                  {vitals.status === "ready-stale" && <StaleTag />}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </>
  );
}

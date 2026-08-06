"use client";

/* THESIS: a bottom-center "now playing" pill for the kiosk wall tablet —
   what's on the Google TV streamer (via Home Assistant), or failing that,
   what the one configured household member is watching on Jellyfin (see
   AppConfig.jellyfin.kioskUser). Hidden entirely when nothing plays: this is
   ambient, ONLY-when-relevant chrome, not a permanent fixture competing with
   the clock/weather/forecast stack for the room's attention.

   Same corner-control idiom as kiosk-glance.tsx's bottom clusters: `fixed`,
   inset baked into the node's own offset (KioskThemeScope's safe-area padding
   only reaches in-flow descendants), and stopPropagation on pointerdown/click
   so a stray tap on the pill can't also promote glance→full underneath it. */

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useKioskNowPlaying } from "@/lib/kiosk-client";
import { cn } from "@/lib/utils";
import { KIOSK_EASE_OUT, KIOSK_FADE_MS } from "@/lib/kiosk-motion";
import type { NowPlayingActive } from "@/lib/nowplaying-types";

export function KioskNowPlaying() {
  const { data } = useKioskNowPlaying();
  const active: NowPlayingActive | null = data?.status === "ok" ? data : null;

  // Same mounted/entered exit-fade idiom as kiosk-alerts.tsx's alert button:
  // `active` can flip back to null the instant playback stops, but the pill
  // stays mounted one more fade's worth of time so that reads as a fade-out
  // rather than the pill popping out of existence mid-poll.
  const [mounted, setMounted] = useState(Boolean(active));
  const [entered, setEntered] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) {
      setMounted(true);
      return;
    }
    setEntered(false);
    const t = setTimeout(() => setMounted(false), KIOSK_FADE_MS);
    return () => clearTimeout(t);
  }, [active]);

  // Split from the effect above so it runs AFTER `mounted` itself commits —
  // the node doesn't exist in the DOM (see `if (!mounted) return null` below)
  // on the same effect run that flips `mounted` true. A forced reflow commits
  // the opacity-0/translate-y-2 resting style before `entered` flips, so the
  // fade-in has a real "before" to transition from instead of sometimes
  // skipping straight to the resting state.
  useEffect(() => {
    if (!mounted) return;
    const node = nodeRef.current;
    if (node) void node.getBoundingClientRect();
    setEntered(true);
  }, [mounted]);

  if (!mounted || !active) return null;

  const playing = active.state === "playing";
  // State (Play/Pause) is the primary read here, not source — which title is
  // ACTIVE right now matters more at a glance than which app it's coming
  // from (a Tv-vs-MonitorPlay source glyph), so playback state always wins.
  const Icon = playing ? Play : Pause;

  return (
    <div
      ref={nodeRef}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "fixed left-1/2 z-(--z-toast) -translate-x-1/2 transition-[opacity,transform] motion-reduce:transition-none",
        entered
          ? "translate-y-0 opacity-100"
          : "translate-y-2 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100",
      )}
      style={{
        bottom: "calc(1rem + env(safe-area-inset-bottom))",
        // Duration/easing live here (not in the className) so they read from
        // the shared kiosk-motion.ts constants; `transition-property` stays
        // class-based so `motion-reduce:transition-none` (which only ever
        // overrides transition-property) still fully cancels the animation —
        // same split as kiosk-status-strip.tsx's revealStyle/revealClass.
        transitionDuration: `${KIOSK_FADE_MS}ms`,
        transitionTimingFunction: KIOSK_EASE_OUT,
      }}
    >
      <div
        role="group"
        aria-label={`Now playing: ${active.title}`}
        className={cn(
          "panel relative flex max-w-[min(90vw,28rem)] items-center gap-2.5 overflow-hidden rounded-full py-2.5 pl-3.5 pr-4",
          // Paused dims the whole pill a touch — a quieter state than
          // playing, without disappearing outright (it's still relevant,
          // just not moving). Kept on this INNER node rather than the outer
          // fixed wrapper: the outer node's own opacity already carries the
          // mount/unmount fade, and stacking a second independent opacity
          // intent on the same CSS property would just overwrite it.
          !playing && "opacity-75",
        )}
      >
        <Icon size={16} className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 truncate text-sm">
          <span className="text-ink">{active.title}</span>
          {active.subtitle && <span className="text-ink-dim"> — {active.subtitle}</span>}
        </span>

        {active.progress01 != null && (
          // Absolute + inset-x-0 so it spans the pill's own width regardless
          // of content length; clipped to the rounded ends by the parent's
          // `overflow-hidden` rather than rounding the bar itself, so it
          // never shows square corners poking past the pill's curve.
          <div
            className="absolute inset-x-0 bottom-0 h-0.5 bg-accent transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
            style={{ width: `${Math.max(0, Math.min(1, active.progress01)) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

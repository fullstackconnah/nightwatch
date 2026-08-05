"use client";

/* THESIS: kiosk-surface.tsx renders KioskForecastRail but is out of bounds
   for this feature (see the radar work item's file-ownership list), so
   there's no way to have a parent component own "is the radar modal open"
   and pass it down as a prop the real call site would actually wire up.
   useKioskRadar() + KioskRadarModal exist so the rail can own that state
   itself: kiosk-forecast.tsx calls the hook, renders this modal when it says
   open, and the Today cell's onClick calls the hook's own open() — no caller
   above it needs to change for the feature to work end-to-end. An
   onTodayClick prop still exists on the rail for a future caller that wants
   to own the modal differently; when absent (the only real case today) this
   self-managed path is what actually fires.

   Dialog semantics copy kiosk-climate.tsx's KioskClimateModal directly (the
   house pattern for a kiosk modal): role="dialog", aria-modal="true" (which
   kiosk-surface.tsx's idle-return timer watches for — see that file), focus
   on open, Escape + Tab-trap, backdrop click closing only on a direct hit
   (target === currentTarget), and focus restored to whatever had it before
   the modal opened. */

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { KIOSK_EASE_OUT, KIOSK_POP_MS, prefersReducedMotion } from "@/lib/kiosk-motion";

interface RadarFrame {
  at: string;
  url: string;
}

type RadarApiResponse =
  | {
      status: "ok";
      product: string;
      place: string;
      site: string;
      layers: { background: string; topography: string; locations: string; range: string };
      frames: RadarFrame[];
    }
  | { status: "unconfigured" }
  | { status: "unreachable" };

export interface UseKioskRadar {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/** Trivial open/close state, split out as its own hook (rather than a plain
 *  useState in the rail) purely so the rail's own code doesn't need to know
 *  this feature exists beyond "call radar.open()" — same reasoning as every
 *  other useKiosk*-style hook in this codebase. */
export function useKioskRadar(): UseKioskRadar {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    open: useCallback(() => setIsOpen(true), []),
    close: useCallback(() => setIsOpen(false), []),
  };
}

const FRAME_HOLD_MS = 500;
// The newest frame gets extra dwell time so a glance at the modal actually
// lands on "right now" rather than catching it mid-loop through the past.
const NEWEST_FRAME_HOLD_MS = 1400;

function formatLocalClock(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Resolves once, `true`/`false` per URL — never rejects, so one bad frame
 *  can't stall Promise.all() for every other layer/frame. */
function preloadImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

interface PreloadState {
  background: boolean;
  topography: boolean;
  locations: boolean;
  range: boolean;
  /** Parallel to `frames` — index i is whether frames[i] loaded cleanly. */
  frameOk: boolean[];
}

export function KioskRadarModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const reducedRef = useRef(false);
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const titleId = "kiosk-radar-modal-title";

  const [data, setData] = useState<RadarApiResponse | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [preload, setPreload] = useState<PreloadState | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);

  // Entrance, focus, and reduced-motion detection — identical shape to
  // KioskClimateModal's own mount effect. `openerRef` captures whatever had
  // focus right before this mounted (the Today button, whichever call site
  // rendered it) so closing can hand focus back without the rail needing to
  // pass a ref down for it.
  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    reducedRef.current = prefersReducedMotion();
    dialogRef.current?.focus();
    if (reducedRef.current) {
      setEntered(true);
      return;
    }
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function requestClose() {
    if (reducedRef.current) {
      onClose();
      openerRef.current?.focus();
      return;
    }
    setClosing(true);
    window.setTimeout(() => {
      onClose();
      openerRef.current?.focus();
    }, KIOSK_POP_MS);
  }

  function onDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key !== "Tab") return;
    const container = dialogRef.current;
    if (!container) return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      e.preventDefault();
      container.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  // Fetch the loop description once on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/kiosk/api/weather/radar")
      .then((res) => res.json() as Promise<RadarApiResponse>)
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setFetchFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Preload every layer + frame before anything is shown, so the loop never
  // stutters partway through its first pass. Runs once per successful fetch.
  useEffect(() => {
    if (!data || data.status !== "ok") return;
    let cancelled = false;
    const { layers, frames } = data;
    Promise.all([
      preloadImage(layers.background),
      preloadImage(layers.topography),
      preloadImage(layers.locations),
      preloadImage(layers.range),
      ...frames.map((f) => preloadImage(f.url)),
    ]).then(([background, topography, locations, range, ...frameOk]) => {
      if (cancelled) return;
      setPreload({ background, topography, locations, range, frameOk });
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const okData = data && data.status === "ok" ? data : null;
  const validFrameIndices =
    okData && preload ? okData.frames.map((_, i) => i).filter((i) => preload.frameOk[i]) : [];

  // Animate through whichever frames actually loaded, oldest to newest, then
  // hold on the newest a little longer before looping. Reduced motion: show
  // the newest valid frame only, no animation loop at all.
  useEffect(() => {
    if (!okData || !preload || validFrameIndices.length === 0) return;
    if (reducedRef.current) {
      setFrameIndex(validFrameIndices[validFrameIndices.length - 1]);
      return;
    }
    let cursor = 0;
    setFrameIndex(validFrameIndices[0]);
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const isNewest = cursor === validFrameIndices.length - 1;
      timer = setTimeout(
        () => {
          cursor = (cursor + 1) % validFrameIndices.length;
          setFrameIndex(validFrameIndices[cursor]);
          step();
        },
        isNewest ? NEWEST_FRAME_HOLD_MS : FRAME_HOLD_MS,
      );
    };
    step();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [okData, preload]);

  const shown = entered && !closing;
  const transitionStyle = { transitionDuration: `${KIOSK_POP_MS}ms`, transitionTimingFunction: KIOSK_EASE_OUT };

  const currentFrame = okData && preload && validFrameIndices.length > 0 ? okData.frames[frameIndex] : null;
  const loading = !data && !fetchFailed;
  const unreachable = fetchFailed || data?.status === "unreachable";
  const unconfigured = data?.status === "unconfigured";
  const layersFailed = okData && preload && !preload.background;
  const stillPreloading = okData && !preload;

  return (
    <div
      aria-hidden={false}
      className="fixed inset-0 z-(--z-modal-backdrop) flex items-center justify-center bg-bg/90 px-4 backdrop-blur-sm transition-opacity motion-reduce:transition-none"
      style={{ ...transitionStyle, opacity: shown ? 1 : 0 }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        className="panel relative z-(--z-modal) w-full max-w-lg p-6 transition-[opacity,transform] motion-reduce:transition-none"
        style={{ ...transitionStyle, opacity: shown ? 1 : 0, transform: shown ? "scale(1)" : "scale(0.96)" }}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-sm font-semibold tracking-tight text-ink">
            Radar{okData ? ` · ${okData.place}` : ""}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close radar"
            className="-mr-2.5 flex h-11 w-11 items-center justify-center text-ink-dim outline-none transition hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {loading && <div className="py-16 text-center text-sm text-ink-dim">Loading radar…</div>}

        {unreachable && (
          <div role="alert" className="py-16 text-center text-sm text-bad">
            Radar is unavailable right now.
          </div>
        )}

        {unconfigured && (
          <div className="py-16 text-center text-sm text-ink-dim">No location configured for the radar.</div>
        )}

        {okData && layersFailed && (
          <div role="alert" className="py-16 text-center text-sm text-bad">
            Radar imagery failed to load.
          </div>
        )}

        {okData && !layersFailed && (
          <>
            <div className="relative mx-auto aspect-square w-full max-w-[520px] overflow-hidden rounded-md bg-panel-2">
              {stillPreloading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-ink-dim">
                  Loading frames…
                </div>
              )}
              {preload && (
                <>
                  {/* z-order: background -> topography -> radar frame ->
                      locations -> range, each absolutely positioned in the
                      same square box. A layer that failed to preload is
                      simply omitted (never rendered with a broken src). */}
                  <img
                    src={okData.layers.background}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  {preload.topography && (
                    <img
                      src={okData.layers.topography}
                      alt=""
                      aria-hidden
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                  {currentFrame && (
                    <img
                      src={currentFrame.url}
                      alt=""
                      aria-hidden
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                  {preload.locations && (
                    <img
                      src={okData.layers.locations}
                      alt=""
                      aria-hidden
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                  {preload.range && (
                    <img
                      src={okData.layers.range}
                      alt=""
                      aria-hidden
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                </>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between text-xs">
              <span className={cn("font-mono", currentFrame ? "text-ink-dim" : "text-ink-faint")}>
                {currentFrame ? formatLocalClock(currentFrame.at) : "No recent frames"}
              </span>
              {/* BOM's terms of use require this attribution wherever their
                  radar imagery is displayed. */}
              <span className="text-ink-faint">Bureau of Meteorology</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

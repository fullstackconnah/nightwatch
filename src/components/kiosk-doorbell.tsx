"use client";

/* THESIS: the front door is the one thing a wall tablet should be allowed to
   interrupt for. Everything else on this surface is ambient — you look at it
   when you choose to — but a person standing at your door is time-bounded:
   the information is worthless ninety seconds later. So this is the only
   component in the kiosk that takes the screen without being asked.

   That privilege is why the opening rule is narrow rather than generous. It
   opens on a fresh trigger (see FRESH_SEC) and nothing else: not on a stale
   timestamp recovered at load, not on the first poll simply because a value
   exists, not on a cat (src/lib/ha-doorbell.ts's NOT_A_VISITOR), and not
   twice for the same ring. A takeover that fires when nobody's there is worse
   than no takeover, because after the second false one nobody trusts it.

   It also closes itself. A camera modal left standing all day is a wall
   tablet that has stopped being a dashboard, and on a battery doorbell an
   MJPEG stream nobody is watching is measurable hardware damage — the picture
   costs something to keep on screen, which is not true of anything else here.
   TAKEOVER_CLOSE_MS and MANUAL_CLOSE_MS are those limits — a screen it took on
   its own goes back quickly, a screen someone asked for stays. Touching the
   panel resets the clock. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { DoorOpen, RefreshCw, Video, VideoOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetcher } from "@/lib/client";
import {
  KIOSK_EASE_OUT,
  KIOSK_POP_MS,
  containerCollapse,
  containerExpand,
  prefersReducedMotion,
} from "@/lib/kiosk-motion";
import { useNow } from "@/lib/use-now";
import type { HaDoorbellSnapshot, HaDoorbellTrigger, HaDoorbellTriggerKind } from "@/lib/ha-types";

/** A doorbell answered thirty seconds late isn't answered. This is the number
 *  that makes the whole feature feel live or not, and it's the only poll on
 *  the kiosk faster than 5s — which is affordable because the payload is a few
 *  hundred bytes and the route caches its upstream fetch (ha-doorbell.ts). */
const POLL_MS = 3000;

/** How recent a trigger must be to TAKE the screen. Deliberately short: this
 *  is also what stops a tablet that reloads at lunchtime from replaying the
 *  morning's delivery, since a fresh mount has no memory of what it's already
 *  shown. Measured against the SERVER's clock (HaDoorbellTrigger.ageSec) — a
 *  wall tablet's own clock drifts, and "is this fresh" must not depend on it. */
const FRESH_SEC = 45;

/** Standing time before the modal gives the surface back, keyed on HOW it got
 *  there — the two cases are not the same promise.
 *
 *  A takeover the tablet performed on its own is an interruption: nobody asked
 *  for it, and whoever walks past thirty seconds later just wants the dashboard
 *  back. It gets 20s, which is a glance at who is at the door, not a viewing
 *  session.
 *
 *  A modal someone opened with the Front door button WAS asked for, so it keeps
 *  the long window — long enough to watch someone walk up the path.
 *
 *  Any touch inside the panel promotes an interruption to the manual window: a
 *  screen someone just touched is not an abandoned one, and an abandoned screen
 *  is the only thing this limit exists to reclaim. */
const TAKEOVER_CLOSE_MS = 20_000;
const MANUAL_CLOSE_MS = 120_000;

/** Only announce the countdown once it's imminent — a timer standing for the
 *  whole window is pressure, a warning in the last few seconds is courtesy.
 *  Capped at half the window, or the 20s takeover would render a countdown from
 *  the moment it appeared, which is the pressure this threshold exists to
 *  avoid. */
const COUNTDOWN_VISIBLE_SEC = 20;
const countdownAt = (windowMs: number) => Math.min(COUNTDOWN_VISIBLE_SEC, Math.floor(windowMs / 2000));

/** A still refreshed at roughly this rate reads as live-ish without asking a
 *  camera for a video stream it may not be able to give. Only used after the
 *  MJPEG stream has actually failed. */
const SNAPSHOT_MS = 1000;

/** How long to wait for the stream's first frame before deciding this camera
 *  can't do MJPEG here. Generous because a battery doorbell has to wake up. */
const STREAM_FIRST_FRAME_MS = 12_000;

const TRIGGER_LABEL: Record<HaDoorbellTriggerKind, string> = {
  ding: "Doorbell rang",
  person: "Someone at the door",
  motion: "Movement at the door",
  activity: "Activity at the door",
};

function cameraUrl(entityId: string, mode: "stream" | "snapshot", bust?: number): string {
  const t = bust === undefined ? "" : `&t=${bust}`;
  return `/kiosk/api/doorbell/camera?entity=${encodeURIComponent(entityId)}&mode=${mode}${t}`;
}

/** Length of the shared leading run of two entity object_ids. Used to pair a
 *  trigger with the camera on its own device without teaching the client the
 *  server's slug rules: `event.outside_front_doorbell_ding` shares 22
 *  characters with `camera.outside_front_doorbell_live_view` and none with
 *  `camera.front_door_fluent`, so the bell opens on the bell's own view while
 *  the driveway camera's person detection opens on the driveway. */
function sharedPrefixLen(a: string, b: string): number {
  const objA = a.slice(a.indexOf(".") + 1);
  const objB = b.slice(b.indexOf(".") + 1);
  let i = 0;
  while (i < objA.length && i < objB.length && objA[i] === objB[i]) i++;
  return i;
}

export function useDoorbellSnapshot() {
  return useSWR<HaDoorbellSnapshot>("/kiosk/api/doorbell", fetcher, {
    refreshInterval: POLL_MS,
    keepPreviousData: true,
    // A doorbell must keep being watched while the tablet sits untouched —
    // which is every moment that matters. SWR's default pauses polling on a
    // hidden tab; a wall display is never "hidden" but a backgrounded browser
    // on iOS is, and coming back to a missed ring is the failure mode.
    refreshWhenHidden: true,
  });
}

export interface DoorbellView {
  /** True once HA has actually named a door camera — the manual button hides
   *  itself rather than opening a modal that can only apologise. */
  hasCamera: boolean;
  open: boolean;
  /** Why it opened; null for a manual open. */
  trigger: HaDoorbellTrigger | null;
  /** Which camera to show first. */
  cameraId: string | null;
  snapshot: HaDoorbellSnapshot | undefined;
  /** The Front door button's rect, ONLY for a manual open (see openManually)
   *  — the modal grows out of it (containerExpand). An automatic ring
   *  takeover has no on-screen trigger to grow from, so it always leaves
   *  this null and keeps its plain pop entrance/exit exactly as before. */
  originRect: DOMRect | null;
  openManually: (rect?: DOMRect) => void;
  close: () => void;
}

/**
 * The watcher. Mounted ONCE (page.tsx) — every other consumer reads the same
 * SWR key and gets the cached snapshot for free, but only this hook decides
 * to take the screen, because two copies of that decision would open two
 * modals.
 *
 * Edge detection is by `firedAt` identity, not by comparing timestamps: HA
 * hands out an instant per event, so "a value I haven't shown yet" is exactly
 * the condition, and it stays correct across a clock change or an entity that
 * reports its events out of order. `seenRef` is seeded on the first snapshot
 * rather than left empty, so a ring that happened before this tablet booted is
 * recorded as already-seen instead of replayed at it.
 */
export function useDoorbellWatch(onTrigger?: () => void): DoorbellView {
  const { data } = useDoorbellSnapshot();
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HaDoorbellTrigger | null>(null);
  const [originRect, setOriginRect] = useState<DOMRect | null>(null);
  const seenRef = useRef<string | null>(null);
  const seededRef = useRef(false);
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  const cameras = useMemo(() => data?.cameras ?? [], [data?.cameras]);
  const latest = data?.latest ?? null;
  const viewCamera = data?.viewCamera ?? null;

  useEffect(() => {
    if (!latest?.firedAt) return;
    const fresh = latest.ageSec !== null && latest.ageSec <= FRESH_SEC;

    // First snapshot of this mount: adopt whatever HA already had as history,
    // never as news — unless it's genuinely within the freshness window, in
    // which case a tablet that just came back up SHOULD show the ring it
    // missed by ten seconds.
    if (!seededRef.current) {
      seededRef.current = true;
      seenRef.current = latest.firedAt;
      if (!fresh) return;
    } else {
      if (latest.firedAt === seenRef.current) return;
      seenRef.current = latest.firedAt;
      if (!fresh) return;
    }

    if (data?.autoOpen === false) return;
    setTrigger(latest);
    // Automatic takeover: no on-screen trigger was tapped, so this always
    // keeps the plain pop entrance/exit — see DoorbellView.originRect.
    setOriginRect(null);
    setOpen(true);
    onTriggerRef.current?.();
  }, [latest, data?.autoOpen]);

  const openManually = useCallback((rect?: DOMRect) => {
    setTrigger(null);
    setOriginRect(rect ?? null);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setTrigger(null);
    setOriginRect(null);
  }, []);

  /* Which camera opens first. A configured `viewCamera` pin wins outright —
     the picture you want is not always the device that noticed (config.ts
     explains the Ring case). Otherwise a trigger picks its own device's
     camera and a manual open gets the resolver's first choice (ha-doorbell.ts
     sorts a camera that says "doorbell" ahead of one that merely lives near
     the door). The last line is reached when the pairing finds nothing —
     better the wrong door camera than a blank panel. The chips inside the
     modal move its own `selected` state, not this. */
  const cameraId = useMemo(() => {
    if (cameras.length === 0) return null;
    if (viewCamera) return viewCamera;
    if (trigger) {
      let best = cameras[0];
      let bestLen = -1;
      for (const c of cameras) {
        const len = sharedPrefixLen(trigger.entityId, c.entityId);
        if (len > bestLen) {
          best = c;
          bestLen = len;
        }
      }
      return best.entityId;
    }
    return cameras[0].entityId;
  }, [cameras, trigger, viewCamera]);

  return { hasCamera: cameras.length > 0, open, trigger, cameraId, snapshot: data, originRect, openManually, close };
}

/* ── the manual control ───────────────────────────────────────────────────── */

/** Sits in the header's control row beside Glance and Admin. Renders nothing
 *  at all when HA has no door camera to offer, rather than a control that
 *  can only fail — the same rule kiosk-alerts.tsx's tray follows. */
export function KioskDoorbellButton({ onClick }: { onClick: (rect?: DOMRect) => void }) {
  const { data } = useDoorbellSnapshot();
  if (!data?.cameras.length) return null;

  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e.currentTarget.getBoundingClientRect());
      }}
      aria-label="View the front door camera"
      className="flex h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs text-ink-dim outline-none transition hover:bg-panel-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
    >
      <DoorOpen size={14} aria-hidden />
      <span>Front door</span>
    </button>
  );
}

/* ── the picture ──────────────────────────────────────────────────────────── */

/**
 * MJPEG first, stills second.
 *
 * Both cameras here do serve `multipart/x-mixed-replace` (verified against the
 * live instance), and an <img> pointed at it is the cheapest possible live
 * view — no player, no dependency, no transcode. But MJPEG in an <img> has one
 * bad failure mode: a stream the browser can't decode never errors, it just
 * never paints, and the modal would sit there black. Hence the first-frame
 * deadline as well as onError — either one drops to polled stills, which every
 * camera integration can produce.
 *
 * The still poller chains on load rather than running on an interval so a slow
 * frame can't stack requests behind itself, and it swaps `src` only after the
 * replacement has decoded, so the picture never blinks through empty.
 */
/** What the picture is currently doing, reported up so the modal's header can
 *  say it. "stills" is a real, visible difference in what you're looking at —
 *  a one-second-old frame, not a live view — and hiding that behind the same
 *  indicator as a working stream would be a lie about a security camera. */
export type CameraStatus = "connecting" | "live" | "stills" | "failed";

function CameraView({
  entityId,
  onStatusChange,
}: {
  entityId: string;
  onStatusChange: (status: CameraStatus) => void;
}) {
  const [mode, setMode] = useState<"stream" | "snapshot">("stream");
  const [snapshotSrc, setSnapshotSrc] = useState<string | null>(null);
  const [painted, setPainted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // A camera change is a fresh start in every respect — including going back
  // to trying MJPEG, since "this camera couldn't stream" says nothing about
  // the next one.
  useEffect(() => {
    setMode("stream");
    setSnapshotSrc(null);
    setPainted(false);
    setFailed(false);
  }, [entityId, attempt]);

  useEffect(() => {
    if (failed && !painted) onStatusChange("failed");
    else if (!painted) onStatusChange("connecting");
    else onStatusChange(mode === "stream" ? "live" : "stills");
  }, [mode, painted, failed, onStatusChange]);

  // First-frame deadline for the stream — see the function comment.
  useEffect(() => {
    if (mode !== "stream" || painted) return;
    const id = window.setTimeout(() => setMode("snapshot"), STREAM_FIRST_FRAME_MS);
    return () => window.clearTimeout(id);
  }, [mode, painted, entityId, attempt]);

  useEffect(() => {
    if (mode !== "snapshot") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      const url = cameraUrl(entityId, "snapshot", Date.now());
      const probe = new window.Image();
      probe.onload = () => {
        if (!alive) return;
        setSnapshotSrc(url);
        setPainted(true);
        setFailed(false);
        timer = setTimeout(tick, SNAPSHOT_MS);
      };
      probe.onerror = () => {
        if (!alive) return;
        setFailed(true);
        // Back off on a failing camera rather than hammering a doorbell that
        // is asleep or a Home Assistant that is restarting.
        timer = setTimeout(tick, SNAPSHOT_MS * 4);
      };
      probe.src = url;
    };
    tick();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [mode, entityId, attempt]);

  const src = mode === "stream" ? cameraUrl(entityId, "stream", attempt) : snapshotSrc;

  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-bg">
      {src && (
        /* eslint-disable-next-line @next/next/no-img-element -- MJPEG: next/image
           would try to optimise a never-ending multipart response. */
        <img
          key={`${entityId}-${mode}-${attempt}`}
          src={src}
          alt="Front door camera"
          className={cn(
            "h-full w-full object-contain transition-opacity motion-reduce:transition-none",
            painted ? "opacity-100" : "opacity-0",
          )}
          style={{ transitionDuration: `${KIOSK_POP_MS}ms`, transitionTimingFunction: KIOSK_EASE_OUT }}
          onLoad={() => setPainted(true)}
          onError={() => {
            if (mode === "stream") setMode("snapshot");
            else setFailed(true);
          }}
        />
      )}

      {!painted && !failed && (
        <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-ink-dim">
          <Video size={16} aria-hidden />
          waking the camera…
        </p>
      )}

      {failed && !painted && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <VideoOff size={20} className="text-ink-faint" aria-hidden />
          <p className="text-sm text-ink-dim">Home Assistant didn&apos;t return a picture for this camera.</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="flex h-14 items-center gap-2 rounded-md border border-line px-5 text-sm text-ink outline-none transition hover:bg-panel-2 focus-visible:ring-1 focus-visible:ring-accent"
          >
            <RefreshCw size={15} aria-hidden />
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

/* ── the modal ────────────────────────────────────────────────────────────── */

export function KioskDoorbellModal({
  cameraId,
  trigger,
  onClose,
  originRect,
}: {
  cameraId: string;
  trigger: HaDoorbellTrigger | null;
  onClose: () => void;
  /** The Front door button's rect for a manual open (see
   *  useDoorbellWatch.originRect) — the panel grows out of it and collapses
   *  back into it. Null for the automatic ring takeover, which keeps its
   *  plain pop entrance/exit exactly as before. */
  originRect?: DOMRect | null;
}) {
  const { data } = useDoorbellSnapshot();
  const cameras = data?.cameras ?? [];
  const [selected, setSelected] = useState(cameraId);
  const [status, setStatus] = useState<CameraStatus>("connecting");
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  // onClose must fire exactly once even though the collapse path arms both
  // an animation-finished handler and a wall-clock safety net (see
  // requestClose) — same guard as KioskClimateModal's closeFiredRef.
  const closeFiredRef = useRef(false);
  // deadline and the window it came from move together: the countdown threshold
  // is derived from the window, so a state where one has updated and the other
  // hasn't would render "closing in 20s" against a 20s window for one frame.
  const [clock, setClock] = useState(() => {
    const windowMs = trigger ? TAKEOVER_CLOSE_MS : MANUAL_CLOSE_MS;
    return { deadline: Date.now() + windowMs, windowMs };
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  const reducedRef = useRef(false);
  const titleId = "kiosk-doorbell-title";

  // A second ring while the modal is already standing re-points it at that
  // trigger's camera and restarts the clock, rather than being swallowed. A ring
  // is a fresh automatic appearance, so it restarts on the SHORT window even if
  // a touch had previously promoted this modal to the manual one — the new
  // interruption is no more asked-for than the first.
  useEffect(() => {
    setSelected(cameraId);
    const windowMs = trigger ? TAKEOVER_CLOSE_MS : MANUAL_CLOSE_MS;
    setClock({ deadline: Date.now() + windowMs, windowMs });
    // Keyed on the ring, deliberately not on `trigger`'s identity: the 3s poll
    // hands back a new object every time, which would restart the window
    // forever and the modal would never close on its own.
  }, [cameraId]);

  // Same entrance idiom as kiosk-climate.tsx's modal: flip a frame after
  // mount so the transition has somewhere to animate from, skipped entirely
  // under reduced motion (the panel still appears, it just doesn't pop).
  useEffect(() => {
    reducedRef.current = prefersReducedMotion();
    const node = dialogRef.current;
    node?.focus();
    if (reducedRef.current) {
      setEntered(true);
      return;
    }
    // Forced reflow, not a single rAF — see kiosk-spark.tsx's useGlide for
    // the measured failure (a rAF callback can coalesce into the same style
    // flush as this mount commit and skip the transition). `node` can be
    // null on a conditionally-rendered dialog; fall back to the instant flip
    // rather than skip the entrance forever.
    if (node) void node.getBoundingClientRect();
    setEntered(true);
  }, []);

  // Container-transform entrance — see kiosk-motion.ts's containerExpand and
  // kiosk-climate.tsx's KioskClimateModal for the house pattern. Layout
  // effect, not effect: must commit before this mount's first paint, or the
  // full-size panel flashes at rest for a frame before snapping down to the
  // Front door button to begin its travel. No-op (containerExpand's own
  // guard) under reduced motion, and a no-op here too for the automatic
  // takeover (originRect null) — that path keeps its plain pop untouched.
  // Mount-only: a second ring re-pointing this same modal instance at a new
  // camera (the effect above, keyed on cameraId) must NOT replay this — the
  // panel is already standing, and the trigger rect is only ever meaningful
  // for the ORIGINAL open.
  useLayoutEffect(() => {
    const node = dialogRef.current;
    const anim = originRect && node ? containerExpand(node, originRect) : null;
    // Cancel on cleanup — for dev StrictMode's mount→cleanup→remount probe,
    // not the real unmount: see KioskClimateModal's identical effect for the
    // measured failure (the re-run otherwise measures through the first
    // animation's frame-0 transform and flattens the FLIP into a fade).
    return () => anim?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestClose = useCallback(() => {
    if (closing) return;
    if (reducedRef.current) {
      onClose();
      return;
    }
    setClosing(true);

    const node = dialogRef.current;
    if (originRect && node) {
      const fireClose = () => {
        if (closeFiredRef.current) return;
        closeFiredRef.current = true;
        onClose();
      };
      const anim = containerCollapse(node, originRect);
      if (anim) {
        anim.finished.catch(() => {}).finally(fireClose);
        // Safety net: `finished` never resolves if the animation is
        // cancelled by an unmount race — the modal must not become
        // undismissable.
        window.setTimeout(fireClose, KIOSK_POP_MS + 80);
        return;
      }
    }
    window.setTimeout(onClose, KIOSK_POP_MS);
  }, [onClose, originRect, closing]);

  const now = useNow(true);
  const secondsLeft = Math.max(0, Math.ceil((clock.deadline - now) / 1000));
  useEffect(() => {
    if (now !== 0 && now >= clock.deadline) requestClose();
  }, [now, clock.deadline, requestClose]);

  // A touch means someone is watching, so this stops being an interruption and
  // gets the window a deliberate open would have had.
  const keepOpen = useCallback(
    () => setClock({ deadline: Date.now() + MANUAL_CLOSE_MS, windowMs: MANUAL_CLOSE_MS }),
    [],
  );

  function onDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
      return;
    }
    keepOpen();
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

  const shown = entered && !closing;
  const transitionStyle = {
    transitionDuration: `${KIOSK_POP_MS}ms`,
    transitionTimingFunction: KIOSK_EASE_OUT,
  };
  const heading = trigger ? TRIGGER_LABEL[trigger.kind] : "Front door";
  const current = cameras.find((c) => c.entityId === selected);

  return (
    <div
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
        // Any touch inside the panel is "I'm still watching" — the auto-close
        // exists to reclaim an ABANDONED screen, not to hurry anyone along.
        onPointerDown={keepOpen}
        className="panel relative z-(--z-modal) w-full max-w-3xl p-4 transition-[opacity,transform] motion-reduce:transition-none md:p-5"
        // With an originRect, WAAPI owns the panel's entrance and exit
        // (containerExpand/-Collapse composite over inline style), so the
        // inline style holds constant resting values and the CSS transition
        // never fires — the pop-path ternaries below are the automatic-
        // takeover (no origin) fallback only, unchanged.
        style={
          originRect
            ? { ...transitionStyle, opacity: 1, transform: "none" }
            : { ...transitionStyle, opacity: shown ? 1 : 0, transform: shown ? "scale(1)" : "scale(0.97)" }
        }
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink">
              {/* The live dot is the answer to "is this now, or the last thing
                  it saw" — the single most important thing to know about a
                  camera picture, and one a still frame cannot tell you. */}
              <span className={cn("dot", status === "live" ? "dot-running" : "dot-stopped")} aria-hidden />
              {heading}
            </h2>
            <p className="mt-0.5 truncate text-xs text-ink-faint">
              {current?.name ?? selected}
              {trigger && trigger.ageSec !== null && ` · ${describeAge(trigger.ageSec)}`}
              {status === "stills" && " · stills"}
            </p>
          </div>

          <button
            type="button"
            onClick={requestClose}
            aria-label="Close the front door camera"
            className="-mr-1.5 -mt-1.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-ink-dim outline-none transition hover:bg-panel-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <CameraView entityId={selected} onStatusChange={setStatus} />

        <div className="mt-3 flex items-center justify-between gap-3">
          {/* Only a house with more than one door camera gets a switcher. One
              camera needs no chips saying so. */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {cameras.length > 1 &&
              cameras.map((c) => (
                <button
                  key={c.entityId}
                  type="button"
                  onClick={() => {
                    setSelected(c.entityId);
                    keepOpen();
                  }}
                  aria-pressed={c.entityId === selected}
                  className={cn(
                    "flex h-14 items-center rounded-md border px-4 text-sm outline-none transition focus-visible:ring-1 focus-visible:ring-accent",
                    c.entityId === selected
                      ? "border-accent/40 bg-accent/10 text-ink"
                      : "border-line bg-panel-2 text-ink-dim hover:text-ink",
                  )}
                >
                  {c.name}
                </button>
              ))}
          </div>

          {secondsLeft <= countdownAt(clock.windowMs) && (
            <p className="shrink-0 font-mono text-xs text-ink-faint" aria-live="off">
              closing in {secondsLeft}s
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function describeAge(ageSec: number): string {
  if (ageSec < 10) return "just now";
  if (ageSec < 60) return `${ageSec}s ago`;
  const mins = Math.round(ageSec / 60);
  return mins === 1 ? "1 min ago" : `${mins} min ago`;
}

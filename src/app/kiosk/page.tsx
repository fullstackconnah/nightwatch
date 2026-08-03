"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { KioskSurface } from "@/components/kiosk-surface";
import { KioskNightOverlay, useKioskPeriod } from "@/components/kiosk-display";
import { KioskPinPad } from "@/components/kiosk-pin-pad";
import { lockKiosk, refreshKioskElevation } from "@/lib/kiosk-client";
import { useNow } from "@/lib/use-now";

// Interactions slide the elevation window, but there's no need to hit the
// network on every single tap inside a fast run of clicks — this floor keeps
// /api/auth/kiosk/refresh calls sane while still feeling instant to a person
// touching the screen.
const SLIDE_MIN_INTERVAL_MS = 15_000;

// Tapping the night overlay wakes the full layout so the tablet stays usable
// after dark, then lets it settle back into the calm clock-only state once
// nobody's touched it for a minute.
const NIGHT_WAKE_MS = 60_000;

// The layout choice is DEVICE-local (localStorage), not server config.
// Glance — the distance-first, wall-mounted-tablet layout — is the default
// for a fresh device: that's the primary use case this app is built for.
// Standard is a deliberate opt-out for a bench/desk device viewed up close,
// and once someone picks it explicitly it keeps winning (see the resolving
// effect below). `?layout=` overrides for testing/demos, same contract as
// ?period=.
//
// redesign-06 §5 repurposes what these two values MEAN without touching the
// key or the override contract: KioskSurface now merges Glance and Standard
// into one surface that changes shape, so "glance" selects that merged,
// auto-returning behaviour (mode animates glance⇄full on interaction/idle)
// while "standard" pins the surface to full and disables auto-return — see
// kiosk-appearance.tsx's relabelled copy ("Auto" / "Always full") for how
// this reads to whoever's picking it.
type KioskLayout = "standard" | "glance";
const LAYOUT_STORAGE_KEY = "kiosk-layout";

function isKioskLayout(v: string | null): v is KioskLayout {
  return v === "standard" || v === "glance";
}

// useKioskPeriod reads useSearchParams (the ?period= test override), which
// Next requires behind a Suspense boundary for the static prerender of this
// page — hence the thin default-export wrapper. The fallback is null on
// purpose: the shell paints on hydration a frame later anyway.
export default function KioskPage() {
  return (
    <Suspense fallback={null}>
      <KioskPageInner />
    </Suspense>
  );
}

function KioskPageInner() {
  const [pinOpen, setPinOpen] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const lastSlideRef = useRef(0);
  const period = useKioskPeriod();
  // Seeded "glance" (the default — see the type comment above) for the SSR
  // pass, same value the resolving effect below falls back to when nothing
  // is stored, so there's no visible layout flash on hydration. localStorage
  // doesn't exist during SSR, hence the effect at all — same hydration-safety
  // shape as useKioskPeriod.
  const [layout, setLayout] = useState<KioskLayout>("glance");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const override = params.get("layout");
    if (isKioskLayout(override)) {
      setLayout(override);
      return;
    }
    const stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    // A deliberate stored choice always wins — only fall through to the
    // "glance" seed above when the device has never chosen.
    if (isKioskLayout(stored)) setLayout(stored);
  }, []);
  const chooseLayout = useCallback((next: KioskLayout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, next);
    } catch {
      // Private-mode storage failures just mean the choice doesn't persist.
    }
  }, []);
  const [nightWoken, setNightWoken] = useState(false);
  const nightWakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards a race between the capture-phase slide-on-interaction handler and
  // an explicit Lock tap: both fire from the same pointerdown, and without
  // this a slide response that resolves after the lock response could
  // silently re-elevate the surface a lock button was just pressed to close.
  const lockingRef = useRef(false);
  // Guards slideExpiry's own async gap: a response landing after unmount
  // must not call setState on a dead component. Same pattern as the mount
  // effect below, just on a ref instead of an effect-local variable since
  // slideExpiry is a stable callback that outlives any single render.
  const slideCancelledRef = useRef(false);

  // Recover an elevation that survived a reload (a wall tablet left mid-
  // session shouldn't demand the PIN again inside its own 5-minute window).
  useEffect(() => {
    let cancelled = false;
    refreshKioskElevation().then((s) => {
      // An unreachable server on mount just means "no elevation to recover" —
      // there's nothing to fall back to yet, so this stays a no-op rather
      // than adopting a half-known state.
      if (!cancelled && s.reachable && s.elevated && s.expiresAt) setExpiresAt(s.expiresAt);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const elevated = expiresAt !== null;
  const now = useNow(elevated);
  useEffect(() => {
    if (expiresAt !== null && now >= expiresAt) setExpiresAt(null);
  }, [now, expiresAt]);

  const isNight = period === "night";
  const showNightOverlay = isNight && !elevated && !nightWoken;
  // Night has no display-band design of its own — the calm overlay below *is*
  // the night treatment. Once it's dismissed (a wake tap) or the surface is
  // elevated, fall back to the day band's compact layout rather than invent a
  // fifth period nobody specified.
  const displayPeriod = isNight ? "day" : period;

  const wakeNight = useCallback(() => {
    setNightWoken(true);
    if (nightWakeTimerRef.current) clearTimeout(nightWakeTimerRef.current);
    nightWakeTimerRef.current = setTimeout(() => setNightWoken(false), NIGHT_WAKE_MS);
  }, []);

  // Leaving night (clock rolls past 5am, or a `?period=` override changes it)
  // drops any pending wake state rather than letting a stale timer flip it
  // back on after the fact.
  useEffect(() => {
    if (!isNight) setNightWoken(false);
  }, [isNight]);

  useEffect(() => {
    return () => {
      if (nightWakeTimerRef.current) clearTimeout(nightWakeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    // Re-armed on every mount, not just cleared on unmount: StrictMode's
    // mount → cleanup → mount cycle would otherwise leave this latched true
    // after the first cleanup and silently discard every slide response for
    // the rest of the dev session.
    slideCancelledRef.current = false;
    return () => {
      slideCancelledRef.current = true;
    };
  }, []);

  const slideExpiry = useCallback(() => {
    const t = Date.now();
    if (t - lastSlideRef.current < SLIDE_MIN_INTERVAL_MS) return;
    lastSlideRef.current = t;
    refreshKioskElevation().then((s) => {
      if (slideCancelledRef.current || lockingRef.current) return;
      if (!s.reachable) {
        // A wifi blip or a restarting container is not the server saying the
        // PIN window expired — leave expiresAt exactly as it is. The wall-
        // clock expiry effect above (`if (expiresAt !== null && now >=
        // expiresAt) setExpiresAt(null)`) already ends the window honestly on
        // time with no server contact required, so nothing here can leave the
        // surface elevated forever; this branch just avoids kicking someone
        // back to the PIN pad over a dropped request. Reset the throttle so
        // the next tap retries immediately instead of sitting out the rest
        // of SLIDE_MIN_INTERVAL_MS.
        lastSlideRef.current = 0;
        return;
      }
      setExpiresAt(s.elevated && s.expiresAt ? s.expiresAt : null);
    });
  }, []);

  const lock = useCallback(async () => {
    lockingRef.current = true;
    await lockKiosk();
    setExpiresAt(null);
  }, []);

  return (
    <div
      className="min-h-screen flex flex-col gap-4 px-3 py-3 md:px-5 md:py-4"
      // Any tap/click anywhere on the elevated surface counts as activity —
      // capture phase so it fires even when the click lands on a button that
      // stops propagation for its own purposes.
      onPointerDownCapture={elevated ? slideExpiry : undefined}
    >
      {/* The surface's single document-level heading — visually hidden since
          a rendered "nightwatch kiosk" title would be visual noise on an
          ambient wall display, but it gives screen-reader users the heading
          outline that every other section caption on this page (promoted to
          h2/h3 elsewhere) hangs off of. */}
      <h1 className="sr-only">nightwatch kiosk</h1>

      {showNightOverlay ? (
        <KioskNightOverlay onAdminClick={() => setPinOpen(true)} onWake={wakeNight} />
      ) : (
        // KioskSurface owns the glance⇄full merge (redesign-06 §5) — it
        // replaces both the old KioskGlance branch and the old "standard"
        // tree below. `initialMode="full"` only matters on the render where
        // this mounts fresh right after a night wake tap (nightWoken flips
        // true and showNightOverlay above goes false in the same commit);
        // every other mount rests in glance, per the contract.
        <KioskSurface
          period={displayPeriod}
          layout={layout}
          onLayoutChange={chooseLayout}
          elevated={elevated}
          expiresAt={expiresAt}
          onAdminClick={() => setPinOpen(true)}
          onLock={lock}
          initialMode={nightWoken ? "full" : "glance"}
        />
      )}

      {pinOpen && (
        <KioskPinPad
          onClose={() => setPinOpen(false)}
          onElevated={(exp) => {
            lastSlideRef.current = Date.now();
            setExpiresAt(exp);
            setPinOpen(false);
          }}
        />
      )}
    </div>
  );
}

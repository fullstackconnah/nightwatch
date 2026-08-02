"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { KioskStatusStrip } from "@/components/kiosk-status-strip";
import { KioskHub } from "@/components/kiosk-hub";
import { KioskDisplay, KioskNightOverlay, useKioskPeriod } from "@/components/kiosk-display";
import { KioskGlance } from "@/components/kiosk-glance";
import { KioskPinPad } from "@/components/kiosk-pin-pad";
import { KioskAdminPanel } from "@/components/kiosk-admin-panel";
import { KioskVoicePanel } from "@/components/kiosk-voice";
import { lockKiosk, refreshKioskElevation } from "@/lib/kiosk-client";
import { KioskAppearance } from "@/components/kiosk-appearance";
import { KioskAttentionCard } from "@/components/kiosk-attention";
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

// The layout choice is DEVICE-local (localStorage), not server config: a
// wall-mounted iPad wants Glance while a bench iPad wants Standard, and both
// point at the same server. `?layout=` overrides for testing/demos, same
// contract as ?period=.
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
  // Seeded "standard" for the SSR pass (localStorage doesn't exist there),
  // resolved in an effect — same hydration-safety shape as useKioskPeriod.
  const [layout, setLayout] = useState<KioskLayout>("standard");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const override = params.get("layout");
    if (isKioskLayout(override)) {
      setLayout(override);
      return;
    }
    const stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
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

  // Recover an elevation that survived a reload (a wall tablet left mid-
  // session shouldn't demand the PIN again inside its own 5-minute window).
  useEffect(() => {
    let cancelled = false;
    refreshKioskElevation().then((s) => {
      if (!cancelled && s.elevated && s.expiresAt) setExpiresAt(s.expiresAt);
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

  const slideExpiry = useCallback(() => {
    const t = Date.now();
    if (t - lastSlideRef.current < SLIDE_MIN_INTERVAL_MS) return;
    lastSlideRef.current = t;
    refreshKioskElevation().then((s) => {
      if (lockingRef.current) return;
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
      {showNightOverlay ? (
        <KioskNightOverlay onAdminClick={() => setPinOpen(true)} onWake={wakeNight} />
      ) : layout === "glance" && !elevated ? (
        // Glance Board: open-ground wall-clock layout. Elevation always falls
        // back to the standard layout below — admin work needs the hub and
        // panels, and that's also where the layout switcher lives.
        <KioskGlance period={displayPeriod} onAdminClick={() => setPinOpen(true)} />
      ) : (
        <>
          <KioskStatusStrip elevated={elevated} onAdminClick={() => setPinOpen(true)} />

          {/* gap-6 between the page's major sections, gap-4 inside the
              elevated tool cluster — rhythm signals grouping strength
              (impeccable layout assessment: one uniform gap everywhere said
              nothing about what belongs together). The elevated tools sit
              ABOVE the hub: someone who just entered a PIN came for these,
              not to scroll past the home controls to find them. */}
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
            {/* Alert-by-exception: renders null when the homelab is healthy.
                First in the column — when it does speak, it matters most. */}
            <KioskAttentionCard />
            <KioskDisplay period={displayPeriod} />

            {elevated && expiresAt !== null && (
              <div className="flex flex-col items-center gap-4">
                <KioskVoicePanel />
                <KioskAppearance layout={layout} onLayoutChange={chooseLayout} />
                <KioskAdminPanel expiresAt={expiresAt} onLock={lock} />
              </div>
            )}

            <KioskHub />
          </div>
        </>
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

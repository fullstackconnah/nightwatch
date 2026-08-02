"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KioskStatusStrip } from "@/components/kiosk-status-strip";
import { KioskHub } from "@/components/kiosk-hub";
import { KioskPinPad } from "@/components/kiosk-pin-pad";
import { KioskAdminPanel } from "@/components/kiosk-admin-panel";
import { KioskVoicePanel } from "@/components/kiosk-voice";
import { lockKiosk, refreshKioskElevation } from "@/lib/kiosk-client";
import { useNow } from "@/lib/use-now";

// Interactions slide the elevation window, but there's no need to hit the
// network on every single tap inside a fast run of clicks — this floor keeps
// /api/auth/kiosk/refresh calls sane while still feeling instant to a person
// touching the screen.
const SLIDE_MIN_INTERVAL_MS = 15_000;

export default function KioskPage() {
  const [pinOpen, setPinOpen] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const lastSlideRef = useRef(0);
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
      <KioskStatusStrip elevated={elevated} onAdminClick={() => setPinOpen(true)} />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
        <KioskHub />
      </div>

      {elevated && expiresAt !== null && (
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4">
          <KioskVoicePanel />
          <KioskAdminPanel expiresAt={expiresAt} onLock={lock} />
        </div>
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

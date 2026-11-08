"use client";

/* Nobody stands in front of a wall-mounted kiosk to click "reload" — so this
   boundary has to do that for itself. The ladder: auto-reset() up to 3 times
   (10s apart, giving a transient render error room to clear on its own),
   then one full window.location.reload() (also picks up a newer JS bundle if
   the crash was a stale chunk after a deploy), then stop and just show the
   manual button — a tight retry loop against a deterministic crash would
   just spin the tablet's CPU forever with nobody there to notice.

   Known gap: a route-segment error.tsx only catches errors from ITS OWN
   segment's rendering, not from src/app/kiosk/layout.tsx — a throw in the
   layout still blanks the screen with nothing to catch it. Fixing that needs
   a root global-error.tsx, out of scope here. */

import { useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { planRecovery, RESET_DELAY_MS, type Phase, type RecoveryState } from "@/lib/kiosk-recovery";

const STORAGE_KEY = "kiosk-error-recovery";

// sessionStorage throws in private/locked-down browsing modes — same
// failure mode the layout override handles for localStorage in
// src/app/kiosk/page.tsx. A read/write failure just means the ladder can't
// remember its position, so it falls back to "start of the ladder" each time.
function readRecoveryState(): RecoveryState {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { attempts: [], escalatedAt: null };
    const parsed = JSON.parse(raw) as Partial<RecoveryState>;
    return {
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      escalatedAt: typeof parsed.escalatedAt === "number" ? parsed.escalatedAt : null,
    };
  } catch {
    return { attempts: [], escalatedAt: null };
  }
}

function writeRecoveryState(state: RecoveryState) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Nothing to fall back to — the next crash just re-derives from scratch.
  }
}

export default function KioskError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("retrying");
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(RESET_DELAY_MS / 1000));

  useEffect(() => {
    const state = readRecoveryState();
    // Attempts only count inside a sliding window (see planRecovery), so a
    // kiosk that crashed once last week doesn't inherit a stale strike count.
    const plan = planRecovery(state, Date.now());
    const { recentAttempts } = plan;
    setPhase(plan.phase);

    let action: () => void;
    if (plan.phase === "retrying") {
      action = () => {
        writeRecoveryState({ attempts: [...recentAttempts, Date.now()], escalatedAt: state.escalatedAt });
        reset();
      };
    } else if (plan.phase === "escalating") {
      action = () => {
        writeRecoveryState({ attempts: recentAttempts, escalatedAt: Date.now() });
        window.location.reload();
      };
    } else {
      // 3 resets and a full reload failed inside this window. Wait it out,
      // then reload once: the next mount starts a fresh ladder, so a wall
      // display recovers on its own after the cause has gone.
      const stuckTimer = setTimeout(() => window.location.reload(), plan.delayMs);
      return () => clearTimeout(stuckTimer);
    }

    setSecondsLeft(Math.ceil(RESET_DELAY_MS / 1000));
    const countdown = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    const timer = setTimeout(action, RESET_DELAY_MS);

    return () => {
      clearInterval(countdown);
      clearTimeout(timer);
    };
    // Runs once per mount only: a fresh crash after a reset() remounts this
    // boundary from scratch, which re-reads sessionStorage and is exactly
    // how the ladder advances from one attempt to the next.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="panel w-full max-w-sm border-warn/40 bg-warn/5 px-5 py-6 flex flex-col items-center gap-4 text-center">
        <AlertTriangle size={28} className="text-warn" aria-hidden />

        <div className="flex flex-col gap-1.5">
          <div className="text-sm font-semibold text-ink">Something went wrong</div>
          <div className="text-xs text-ink-dim">
            {phase === "stuck"
              ? "It couldn't fix itself yet. It will try again in a few minutes, or tap Reload."
              : "This screen is fixing itself — no need to touch anything."}
          </div>
        </div>

        {phase !== "stuck" && (
          <div className="text-xs font-mono text-ink-dim tabular-nums">
            {phase === "retrying" ? `retrying in ${secondsLeft}s…` : `reloading in ${secondsLeft}s…`}
          </div>
        )}

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="h-14 w-full rounded-tile border border-accent/30 bg-accent/10 text-accent text-sm font-semibold flex items-center justify-center gap-2 outline-none hover:bg-accent/20 focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] transition"
        >
          <RotateCw size={16} aria-hidden />
          Reload
        </button>

        {error.digest && (
          <div className="text-2xs font-mono text-ink-faint tabular-nums">ref {error.digest}</div>
        )}
      </div>
    </div>
  );
}

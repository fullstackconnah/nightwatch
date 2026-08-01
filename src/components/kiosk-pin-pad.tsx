"use client";

import { useEffect, useRef, useState } from "react";
import { Delete, Lock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/use-now";
import { submitKioskPin } from "@/lib/kiosk-client";

const PIN_LENGTH = 4;
// "" marks the empty bottom-left cell so 0 lands centred, phone-keypad style.
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;

export function KioskPinPad({
  onElevated,
  onClose,
}: {
  onElevated: (expiresAt: number) => void;
  onClose: () => void;
}) {
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  // Only ticks while actually locked out — the countdown reads off the
  // server's own lockedUntil timestamp, not a client-started timer, so it
  // can't drift from the rate limiter it's describing.
  const now = useNow(lockedUntil !== null);
  const lockedRemainingMs = lockedUntil !== null ? Math.max(0, lockedUntil - now) : 0;
  useEffect(() => {
    if (lockedUntil !== null && now >= lockedUntil) setLockedUntil(null);
  }, [now, lockedUntil]);

  async function submit(pin: string) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    const result = await submitKioskPin(pin);
    submittingRef.current = false;
    setBusy(false);

    if (result.ok && result.expiresAt) {
      onElevated(result.expiresAt);
      return;
    }

    setDigits("");
    setError(result.error ?? "Incorrect PIN");
    if (result.lockedUntil) setLockedUntil(result.lockedUntil);
    setShake(true);
    window.setTimeout(() => setShake(false), 420);
  }

  function press(key: string) {
    if (busy || lockedUntil !== null || !key) return;
    if (key === "back") {
      setDigits((d) => d.slice(0, -1));
      return;
    }
    setError(null);
    const next = (digits + key).slice(0, PIN_LENGTH);
    setDigits(next);
    if (next.length === PIN_LENGTH) void submit(next);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 backdrop-blur-sm px-4">
      <div className={cn("panel w-full max-w-xs p-6", shake && "kiosk-pin-shake")}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Lock size={15} className="text-accent" />
            <span className="text-sm font-semibold tracking-tight">Admin PIN</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel"
            className="h-11 w-11 -mr-2.5 flex items-center justify-center text-ink-dim hover:text-ink outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-md"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex justify-center gap-2.5 mb-5">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-12 w-10 rounded-md border flex items-center justify-center font-mono text-lg",
                i < digits.length ? "border-accent/50 text-ink bg-panel-2" : "border-line text-ink-faint",
              )}
            >
              {i < digits.length ? "•" : ""}
            </div>
          ))}
        </div>

        <div className="text-center text-xs mb-4 min-h-4" role="alert">
          {lockedUntil !== null ? (
            <span className="text-warn">
              Too many attempts — try again in {Math.ceil(lockedRemainingMs / 1000)}s
            </span>
          ) : error ? (
            <span className="text-bad">{error}</span>
          ) : (
            <span className="text-ink-dim">Enter the 4-digit PIN</span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((key, i) =>
            key === "" ? (
              <div key={i} aria-hidden="true" />
            ) : (
              <button
                key={i}
                type="button"
                disabled={busy || lockedUntil !== null}
                onClick={() => press(key)}
                aria-label={key === "back" ? "Backspace" : `digit ${key}`}
                className="h-14 rounded-md border border-line text-ink font-mono text-lg hover:bg-panel-2 hover:border-line-bright disabled:opacity-40 disabled:pointer-events-none focus-visible:ring-1 focus-visible:ring-accent outline-none active:scale-[0.98] transition"
              >
                {key === "back" ? <Delete size={18} className="mx-auto" /> : key}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

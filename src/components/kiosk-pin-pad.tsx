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
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstKeyRef = useRef<HTMLButtonElement>(null);

  // Initial focus lands on the first digit key, not the Cancel button — a
  // keyboard user opening this modal is here to type a PIN, not to leave.
  // Restoring focus to whatever triggered the modal on unmount (Cancel, a
  // correct PIN, or Escape all unmount this component the same way) keeps a
  // keyboard user anchored where they were instead of dumped at document top.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    firstKeyRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

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

  // Escape rides the same path as the Cancel button; Tab/Shift+Tab cycle
  // within the dialog's own focusable elements so a keyboard user can't tab
  // out into the page behind it. Handled as a React onKeyDown (bubbles up
  // from whichever key/button is focused) rather than a document listener,
  // so there's no manual addEventListener to leak on this long-lived kiosk.
  function onDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
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
      // Nothing tabbable inside (shouldn't happen with real content, but the
      // container is tabIndex={-1} precisely so it has somewhere safe to land).
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 backdrop-blur-sm px-4"
      // The trap above only ever runs from a keydown that bubbles through a
      // focused descendant — it can't fire once focus has been knocked out
      // to document.body. A tap on this backdrop (not itself focusable, no
      // click handler) is exactly that: the default pointerdown behavior
      // would blur whatever was focused with nothing to receive it. Blocking
      // that default keeps focus exactly where it was — this does NOT close
      // the pin pad; that stays Cancel/Escape/a resolved PIN only, unchanged.
      // target===currentTarget guards against pointerdown bubbling up from a
      // real control inside the dialog — this pad has no input today, but
      // suppressing a descendant's default would silently steal its focus.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kiosk-pin-pad-title"
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        className={cn("panel w-full max-w-xs p-6", shake && "kiosk-pin-shake")}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Lock size={15} className="text-accent" />
            <span id="kiosk-pin-pad-title" className="text-sm font-semibold tracking-tight">
              Admin PIN
            </span>
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
                ref={key === "1" ? firstKeyRef : undefined}
                type="button"
                disabled={busy || lockedUntil !== null}
                onClick={() => press(key)}
                aria-label={key === "back" ? "Backspace" : `digit ${key}`}
                // kiosk-press replaces active:scale-[0.98] + the bare
                // `transition` utility (see globals.css's KIOSK MOTION
                // VOCABULARY) — `.kiosk-press` already transitions
                // background-color/border-color, which is all the hover
                // state here touches. These are the most-pressed controls on
                // the whole surface, so this is where the new feel matters most.
                className="h-14 rounded-md border border-line text-ink font-mono text-lg hover:bg-panel-2 hover:border-line-bright disabled:opacity-40 disabled:pointer-events-none focus-visible:ring-1 focus-visible:ring-accent outline-none kiosk-press"
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

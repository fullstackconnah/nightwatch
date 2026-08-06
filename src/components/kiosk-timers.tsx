"use client";

/* THESIS: the kitchen wants several pots on the stove at once — pasta,
   eggs, a load of laundry — tracked from anywhere in the room, not just
   from whoever is standing at the panel. A compact status-strip button is
   the entry (own-world with KioskStatusStrip's Admin button: h-11, mono
   figure, accent-when-live), opening a pin-pad-style fixed overlay (same
   `fixed inset-0 z-50 bg-bg/90 backdrop-blur-sm` + centered `.panel` shell
   as kiosk-pin-pad.tsx) that hosts presets, a custom stepper and the
   running timers themselves as large hand-rolled ring gauges — the one
   sanctioned SVG chart idiom per DESIGN.md, here reused for a countdown.

   STATE: a module-level store (useSyncExternalStore, same shape as
   use-now.ts's shared 1 Hz clock) so KioskTimersButton can be mounted in
   both the status strip and the glance layout and stay in sync without a
   context provider. Timers tick from absolute `endsAt` timestamps, never a
   decrementing counter, so a backgrounded kiosk tab can't drift them —
   restoring from localStorage on mount naturally shows a timer that
   expired while away as already finished, no special-case needed. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play, Timer as TimerIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/use-now";

/* ── shared store ────────────────────────────────────────────────────────── */

interface KioskTimer {
  id: string;
  name: string;
  /** Original length in ms — the ring gauge's denominator, and what a
   *  pause/resume cycle needs to reconstruct `endsAt`. */
  durationMs: number;
  /** Absolute completion timestamp. Meaningless while paused. */
  endsAt: number;
  /** Non-null while paused: the remaining ms frozen at the moment of pause. */
  pausedRemainingMs: number | null;
}

const STORAGE_KEY = "kiosk-timers";
const CHIME_INTERVAL_MS = 4000;

let timers: KioskTimer[] = [];
const listeners = new Set<() => void>();
let restored = false;
let chimeTimer: ReturnType<typeof setInterval> | null = null;
let audioCtx: AudioContext | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
  } catch {
    // Private mode / quota exceeded — timers keep running for this session,
    // they just won't survive a reload.
  }
}

function restoreOnce() {
  if (restored || typeof window === "undefined") return;
  restored = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) timers = parsed as KioskTimer[];
  } catch {
    // Corrupt payload — start empty rather than throw on a kitchen kiosk.
  }
}

/* Two-tone chime, built from oscillators — no audio asset in the bundle.
   The AudioContext is created lazily from `addTimer`, which only ever runs
   inside a click handler (a preset chip or the custom Start button), so the
   very first tap that starts a timer is the user gesture iOS needs to
   unlock playback; every chime after that, including ones fired minutes
   later with the overlay closed, reuses that already-unlocked context. */
function ensureAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) return audioCtx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

function playTone(ctx: AudioContext, freq: number, startTime: number, duration: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.22, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function playChime() {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") void audioCtx.resume();
  const t0 = audioCtx.currentTime;
  playTone(audioCtx, 880, t0, 0.16);
  playTone(audioCtx, 1320, t0 + 0.19, 0.18);
}

function hasUnacknowledgedFinish(now: number): boolean {
  return timers.some((t) => t.pausedRemainingMs === null && now >= t.endsAt);
}

/* Mirrors use-now.ts's own lifecycle: the repeating chime only needs to run
   while something is mounted to hear it, so it starts on the first
   subscriber and stops on the last — a kiosk with the tab closed doesn't
   need a background interval nobody's around for. */
function startChimeLoopIfNeeded() {
  if (chimeTimer !== null) return;
  chimeTimer = setInterval(() => {
    if (hasUnacknowledgedFinish(Date.now())) playChime();
  }, CHIME_INTERVAL_MS);
}

function stopChimeLoopIfIdle() {
  if (chimeTimer !== null && listeners.size === 0) {
    clearInterval(chimeTimer);
    chimeTimer = null;
  }
}

function subscribe(onChange: () => void): () => void {
  restoreOnce();
  listeners.add(onChange);
  startChimeLoopIfNeeded();
  return () => {
    listeners.delete(onChange);
    stopChimeLoopIfIdle();
  };
}

function getSnapshot(): KioskTimer[] {
  return timers;
}

// A stable module-level constant, NOT a fresh [] per call: React compares
// server-snapshot results by reference and treats a new array every render
// as "the store changed", warning in dev and risking a render loop.
const SERVER_SNAPSHOT: KioskTimer[] = [];
function getServerSnapshot(): KioskTimer[] {
  return SERVER_SNAPSHOT;
}

function useTimers(): KioskTimer[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function addTimer(name: string, minutes: number) {
  ensureAudioContext(); // must happen inside this click-handler-only call to count as the unlocking gesture
  const durationMs = minutes * 60_000;
  const timer: KioskTimer = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || `${minutes}m timer`,
    durationMs,
    endsAt: Date.now() + durationMs,
    pausedRemainingMs: null,
  };
  timers = [...timers, timer];
  persist();
  emit();
}

function removeTimer(id: string) {
  timers = timers.filter((t) => t.id !== id);
  persist();
  emit();
}

function pauseTimer(id: string) {
  timers = timers.map((t) =>
    t.id === id && t.pausedRemainingMs === null
      ? { ...t, pausedRemainingMs: Math.max(0, t.endsAt - Date.now()) }
      : t,
  );
  persist();
  emit();
}

function resumeTimer(id: string) {
  timers = timers.map((t) =>
    t.id === id && t.pausedRemainingMs !== null
      ? { ...t, endsAt: Date.now() + t.pausedRemainingMs, pausedRemainingMs: null }
      : t,
  );
  persist();
  emit();
}

/* ── shared math ─────────────────────────────────────────────────────────── */

function remainingMs(t: KioskTimer, now: number): number {
  return t.pausedRemainingMs !== null ? t.pausedRemainingMs : Math.max(0, t.endsAt - now);
}

function isFinished(t: KioskTimer, now: number): boolean {
  return t.pausedRemainingMs === null && now >= t.endsAt;
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ── entry affordance ───────────────────────────────────────────────────── */

export function KioskTimersButton({ className }: { className?: string }) {
  const list = useTimers();
  const [open, setOpen] = useState(false);
  const live = list.some((t) => t.pausedRemainingMs === null);
  const now = useNow(live);

  const { soonestMs, finished, active } = useMemo(() => {
    let soonest = Infinity;
    let anyFinished = false;
    let anyActive = false;
    for (const t of list) {
      if (isFinished(t, now)) {
        anyFinished = true;
        continue;
      }
      anyActive = true;
      soonest = Math.min(soonest, remainingMs(t, now));
    }
    return { soonestMs: soonest === Infinity ? null : soonest, finished: anyFinished, active: anyActive };
  }, [list, now]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={list.length > 0 ? `Timers — ${list.length} set` : "Timers"}
        className={cn(
          // kiosk-press replaces active:scale-[0.98] + the bare `transition`
          // utility (see globals.css's KIOSK MOTION VOCABULARY) — this file has
          // eight such sites; `.kiosk-press` already transitions
          // background-color/border-color/color for all of them. The `animate-pulse`
          // below (finished state) is untouched: it animates opacity, which
          // `.kiosk-press` does not own.
          "flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs outline-none kiosk-press focus-visible:ring-1 focus-visible:ring-accent",
          finished
            ? "animate-pulse border-warn/50 bg-warn/10 text-warn motion-reduce:animate-none"
            : active
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-line text-ink-dim hover:border-line-bright hover:bg-panel-2 hover:text-ink",
          className,
        )}
      >
        <TimerIcon size={15} aria-hidden />
        {soonestMs != null && (
          <span className="font-mono tabular-nums">{formatRemaining(soonestMs)}</span>
        )}
      </button>
      {open && <KioskTimersOverlay onClose={() => setOpen(false)} />}
    </>
  );
}

/* ── overlay ─────────────────────────────────────────────────────────────── */

const PRESETS: { name: string; minutes: number }[] = [
  { name: "Pasta", minutes: 10 },
  { name: "Eggs", minutes: 7 },
  { name: "Rice", minutes: 15 },
  { name: "Laundry", minutes: 45 },
  { name: "Pizza", minutes: 12 },
];

function KioskTimersOverlay({ onClose }: { onClose: () => void }) {
  const list = useTimers();
  const live = list.some((t) => t.pausedRemainingMs === null);
  const now = useNow(live);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);

  // Same contract as kiosk-pin-pad.tsx: focus the overlay's primary control
  // on open (the first preset — always rendered, never destructive, unlike
  // a timer card's Cancel button which may or may not exist), restore focus
  // to the trigger on unmount.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    firstFocusRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  // Escape maps to the same onClose the backdrop-click and X button already
  // use — closing this overlay only hides it, running timers are untouched
  // either way, so there's no separate "what does closing mean" question
  // here to preserve. Tab/Shift+Tab cycle within the dialog, same shape as
  // the pin pad's trap.
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
      // Same gap as kiosk-pin-pad.tsx's backdrop, plus one: this backdrop
      // DOES close on click (unchanged — see onClick above), but a
      // mousedown/touchdown that doesn't resolve into a click on this same
      // element (e.g. a drag that ends elsewhere) still blurs focus to
      // document.body without closing anything, breaking the trap for the
      // rest of the session. Blocking the default pointerdown behavior
      // covers that non-closing case without touching the click-to-close path.
      // target===currentTarget scopes this to the scrim itself — pointerdown
      // bubbles, and without the guard a tap on the custom-timer name input
      // (:538) would have its own default focus suppressed by this handler.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kiosk-timers-title"
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        className="panel flex max-h-full w-full max-w-2xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <TimerIcon size={15} className="text-accent" aria-hidden />
            <h2 id="kiosk-timers-title" className="text-sm font-semibold tracking-tight">
              Timers
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2.5 flex h-11 w-11 items-center justify-center rounded-md text-ink-dim outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {list.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {list.map((t) => (
                <TimerCard key={t.id} timer={t} now={now} />
              ))}
            </div>
          )}

          <PresetRow firstFocusRef={firstFocusRef} />
          <CustomRow />
        </div>
      </div>
    </div>
  );
}

/* ── running timer card ─────────────────────────────────────────────────── */

function TimerRing({ progress, warn }: { progress: number; warn: boolean }) {
  const size = 136;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - progress);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={warn ? "var(--color-warn)" : "var(--color-accent)"}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        vectorEffect="non-scaling-stroke"
        // Transition as Tailwind utilities, not inline style: an inline
        // `style.transition` sits at higher specificity than any class and
        // would silently defeat a `motion-reduce:` class-based override, so
        // the sweep has to be class-driven for the gate below to work at
        // all. Under reduced motion this collapses to no transition — the
        // stroke still jumps straight to the new progress value each tick,
        // it just doesn't ease there.
        //
        // 900ms/linear, not a KIOSK_*_MS vocabulary token: `now` (and so
        // `progress`) only actually changes once a second (use-now.ts's
        // shared 1Hz timer), so this transition is tracking that 1s tick,
        // not an entrance/move/pop. 900ms — just under the tick period —
        // means each step finishes easing before the next one lands, so the
        // ring reads as continuous motion instead of stalling between beats;
        // linear because an ease here would visibly slow down right as the
        // next tick arrives to speed it back up.
        className="transition-[stroke-dashoffset] duration-[900ms] ease-linear motion-reduce:transition-none"
      />
    </svg>
  );
}

function TimerCard({ timer, now }: { timer: KioskTimer; now: number }) {
  const finished = isFinished(timer, now);
  const paused = timer.pausedRemainingMs !== null;
  const remaining = remainingMs(timer, now);
  const progress = finished ? 1 : Math.min(1, Math.max(0, remaining / timer.durationMs));

  return (
    <div
      className={cn(
        "panel flex flex-col items-center gap-3 p-4",
        finished && "animate-pulse motion-reduce:animate-none",
      )}
    >
      <div className="microlabel max-w-full truncate" title={timer.name}>
        {timer.name}
      </div>

      <div className="relative flex items-center justify-center">
        <TimerRing progress={progress} warn={finished} />
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-0.5"
          role={finished ? "status" : undefined}
        >
          <span
            className={cn(
              "font-mono text-4xl leading-none tabular-nums",
              finished ? "text-warn" : "text-ink",
            )}
          >
            {formatRemaining(remaining)}
          </span>
          {paused && !finished && <span className="microlabel">paused</span>}
          {finished && <span className="microlabel !text-warn">done</span>}
        </div>
      </div>

      <div className="flex w-full items-center justify-center gap-2">
        {finished ? (
          <button
            type="button"
            onClick={() => removeTimer(timer.id)}
            className="h-11 min-w-24 rounded-md border border-warn/40 bg-warn/10 px-4 text-sm text-warn outline-none kiosk-press hover:bg-warn/20 focus-visible:ring-1 focus-visible:ring-accent"
          >
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => (paused ? resumeTimer(timer.id) : pauseTimer(timer.id))}
              aria-label={paused ? `Resume ${timer.name}` : `Pause ${timer.name}`}
              className="flex h-11 w-11 items-center justify-center rounded-md border border-line text-ink-dim outline-none kiosk-press hover:border-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
            >
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button
              type="button"
              onClick={() => removeTimer(timer.id)}
              aria-label={`Cancel ${timer.name}`}
              className="h-11 rounded-md border border-bad/30 px-4 text-sm text-bad outline-none kiosk-press hover:bg-bad/10 focus-visible:ring-1 focus-visible:ring-accent"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── presets + custom row ───────────────────────────────────────────────── */

function PresetRow({
  firstFocusRef,
}: {
  firstFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div>
      <div className="microlabel mb-2">Presets</div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p, i) => (
          <button
            key={p.name}
            ref={i === 0 ? firstFocusRef : undefined}
            type="button"
            onClick={() => addTimer(p.name, p.minutes)}
            className="h-11 rounded-tile border border-line px-3 text-xs text-ink-dim outline-none kiosk-press hover:border-line-bright hover:bg-panel-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
          >
            {p.name} <span className="font-mono tabular-nums text-ink-faint">{p.minutes}m</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const CUSTOM_STEPS = [1, 5, 10] as const;

function CustomRow() {
  const [minutes, setMinutes] = useState(0);
  const [name, setName] = useState("");

  const start = () => {
    if (minutes <= 0) return;
    addTimer(name, minutes);
    setMinutes(0);
    setName("");
  };

  return (
    <div>
      <div className="microlabel mb-2">Custom</div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
        />

        <span className="w-16 text-center font-mono text-lg tabular-nums text-ink">{minutes}m</span>

        {CUSTOM_STEPS.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => setMinutes((m) => m + step)}
            aria-label={`Add ${step} minute${step > 1 ? "s" : ""}`}
            className="h-11 min-w-11 rounded-md border border-line px-2.5 font-mono text-sm text-ink-dim outline-none kiosk-press hover:border-line-bright hover:bg-panel-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
          >
            +{step}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setMinutes(0)}
          aria-label="Clear minutes"
          disabled={minutes === 0}
          // disabled:pointer-events-none disabled:opacity-40: `.kiosk-press`'s
          // own rule is `:active:not(:disabled)`, so this button correctly
          // stops depressing once disabled rather than fighting the opacity dim.
          className="h-11 rounded-md border border-line px-3 text-xs text-ink-dim outline-none kiosk-press hover:border-line-bright hover:bg-panel-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40"
        >
          Clear
        </button>

        <button
          type="button"
          onClick={start}
          disabled={minutes <= 0}
          // Same disabled:not(:disabled) reasoning as the Clear button above —
          // `.kiosk-press` correctly withholds the depression once disabled.
          className="h-11 rounded-md border border-accent/30 bg-accent/10 px-4 text-sm text-accent outline-none kiosk-press hover:bg-accent/20 focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40"
        >
          Start
        </button>
      </div>
    </div>
  );
}

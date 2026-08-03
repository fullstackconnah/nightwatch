"use client";

import { useEffect, useRef, useState } from "react";
import { Lock as LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HaEntities, HaLock, HaLockState } from "@/lib/ha-types";
import type { UseHaResult } from "@/lib/use-ha";
import { cn } from "@/lib/utils";

/** A lock is a door — no accidental taps. First tap arms the button; the same
 *  button must be tapped again within this window to actually send the
 *  command, otherwise it quietly disarms. */
const CONFIRM_WINDOW_MS = 4000;

const STATE_LABEL: Record<HaLockState, string> = {
  locked: "locked",
  unlocked: "unlocked",
  locking: "locking…",
  unlocking: "unlocking…",
  jammed: "jammed",
  unavailable: "unavailable",
  unknown: "state unknown",
};

/**
 * Neutral by default — DESIGN.md's Threshold Rule: "unlocked" is a normal
 * operating state, not a fault, so it gets the same undyed treatment as
 * "locked" rather than a warn colour it hasn't earned. Only a real device
 * problem (jammed) or a mid-flight transition (locking/unlocking, mirroring
 * the app's existing `restarting` = blue idiom) gets colour.
 */
function stateTone(state: HaLockState): string {
  if (state === "jammed") return "text-bad";
  if (state === "locking" || state === "unlocking") return "text-blue";
  if (state === "unavailable" || state === "unknown") return "text-ink-faint";
  return "text-ink-dim";
}

export function HaLocksPanel({
  ha,
  locks,
  entities,
}: {
  ha: UseHaResult;
  locks: HaLock[];
  entities: HaEntities;
}) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <LockIcon size={13} className="text-ink-faint" aria-hidden />
        <span className="microlabel">Locks</span>
      </div>

      {locks.length === 0 ? (
        <p className="text-xs text-ink-faint">No locks exposed by Home Assistant.</p>
      ) : (
        <ul className="divide-y divide-line/50">
          {locks.map((lock) => (
            <HaLockRow key={lock.entityId} lock={lock} ha={ha} entities={entities} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HaLockRow({ lock, ha, entities }: { lock: HaLock; ha: UseHaResult; entities: HaEntities }) {
  const [armed, setArmed] = useState<"lock" | "unlock" | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const error = ha.actionErrors[lock.entityId];

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const disarm = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setArmed(null);
  };

  const request = (action: "lock" | "unlock") => {
    if (armed === action) {
      disarm();
      const optimisticState: HaLockState = action === "lock" ? "locking" : "unlocking";
      const next: HaEntities = {
        ...entities,
        locks: entities.locks.map((l) => (l.entityId === lock.entityId ? { ...l, state: optimisticState } : l)),
      };
      void ha.runAction({ entityId: lock.entityId, action }, next);
      return;
    }
    setArmed(action);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setArmed(null), CONFIRM_WINDOW_MS);
  };

  const canLock = lock.available && lock.state !== "locked" && lock.state !== "locking";
  const canUnlock = lock.available && lock.state !== "unlocked" && lock.state !== "unlocking";

  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-ink">{lock.name}</div>
          <div className={cn("mt-0.5 font-mono text-[0.7rem]", stateTone(lock.state))}>{STATE_LABEL[lock.state]}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant={armed === "lock" ? "default" : "outline"}
            disabled={!canLock}
            onClick={() => request("lock")}
            aria-label={armed === "lock" ? `Confirm lock ${lock.name}` : `Lock ${lock.name}`}
          >
            {armed === "lock" ? "Confirm lock" : "Lock"}
          </Button>
          <Button
            size="sm"
            variant={armed === "unlock" ? "danger" : "outline"}
            disabled={!canUnlock}
            onClick={() => request("unlock")}
            aria-label={armed === "unlock" ? `Confirm unlock ${lock.name}` : `Unlock ${lock.name}`}
          >
            {armed === "unlock" ? "Confirm unlock" : "Unlock"}
          </Button>
        </div>
      </div>

      {/* The self-arm window is otherwise silent — nothing on screen explains why
          the button reverted if the second tap never comes. This is the one line
          that makes the timeout visible instead of mysterious; role="status" also
          gets it announced to a screen reader, which the label swap alone doesn't. */}
      {armed && (
        <p role="status" className="mt-1.5 text-[0.7rem] text-ink-faint">
          Tap again to confirm — cancels itself in {CONFIRM_WINDOW_MS / 1000}s.
        </p>
      )}

      {error && (
        <div role="alert" className="mt-1.5 flex items-start gap-2 text-[0.7rem] text-bad">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={() => ha.dismissActionError(lock.entityId)}
            aria-label="Dismiss error"
            // DESIGN.md's 44px Rule: this control had no size class at all, so
            // it rendered at content size (~18px). min-h-11 md:min-h-0 is the
            // idiom this app already uses for inline text dismiss buttons
            // (reclaim-shared.tsx, log-console.tsx) — height only, since the
            // control sits beside wrapping error text rather than in its own row.
            className="inline-flex items-center shrink-0 rounded px-1 min-h-11 md:min-h-0 text-ink-dim outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
          >
            ×
          </button>
        </div>
      )}
    </li>
  );
}

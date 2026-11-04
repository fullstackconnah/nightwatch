"use client";

import { useState } from "react";
import { WriteAction } from "@/components/strips/write-action";
import { RowError } from "@/components/smarthome/shared";
import { CONFIRM_WINDOW_MS, LOCK_WORD, anyLockBusy, lockWrites } from "@/lib/smarthome/page-model";
import type { HaEntities, HaLock } from "@/lib/types/ha";
import type { UseHaResult } from "@/lib/use-ha";

interface LockProps {
  ha: UseHaResult;
  entities: HaEntities;
  stale: boolean;
  lockBusy: boolean;
  onPending: (pending: boolean) => void;
}

/** Lock and Unlock for one lock: each asks once (the question cancels itself), and one frame shows at a time. */
export function LockActions({ lock, ha, entities, stale, lockBusy, onPending }: LockProps & { lock: HaLock }) {
  const [asking, setAsking] = useState<"lock" | "unlock" | null>(null);
  const can = lockWrites(lock, { stale, busy: anyLockBusy(entities.locks, lockBusy) });
  const act = (action: "lock" | "unlock") => async () => {
    const next: HaEntities = {
      ...entities,
      locks: entities.locks.map((l) => (l.entityId === lock.entityId ? { ...l, state: action === "lock" ? "locking" : "unlocking" } : l)),
    };
    if (!(await ha.runAction({ entityId: lock.entityId, action }, next))) throw new Error("the lock didn’t respond");
  };
  const one = (action: "lock" | "unlock") =>
    (asking === null || asking === action) && (
      <WriteAction
        key={action}
        label={action === "lock" ? "Lock" : "Unlock"}
        ariaLabel={`${action === "lock" ? "Lock" : "Unlock"} ${lock.name}`}
        say={`${action === "lock" ? "Lock" : "Unlock"} the ${lock.name.toLowerCase()}?`}
        yes={`Yes, ${action}`}
        danger={action === "unlock"}
        flight={action === "lock" ? "Locking…" : "Unlocking…"}
        failure={`Couldn’t ${action} the ${lock.name.toLowerCase()}`}
        disabled={!can[action]}
        autoCancelMs={CONFIRM_WINDOW_MS}
        onPending={onPending}
        onActive={(a) => setAsking((cur) => (a ? action : cur === action ? null : cur))}
        run={act(action)}
      />
    );
  return (
    <div className="flex flex-wrap items-center gap-2" data-entity={lock.entityId}>
      {one("lock")}
      {one("unlock")}
    </div>
  );
}

export function LockDetail(p: LockProps & { inSlot?: boolean }) {
  if (p.entities.locks.length === 0) return <p className="st-note">Home Assistant shares no locks.</p>;
  return (
    <ul className="divide-y divide-line/50">
      {p.entities.locks.map((l) => (
        <li key={l.entityId} className="py-3 first:pt-0 last:pb-0">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="truncate text-xs text-ink">{l.name}</span>
            <span className={l.state === "jammed" ? "microlabel !text-bad" : l.state === "unavailable" ? "microlabel !text-warn" : "microlabel"}>{LOCK_WORD[l.state]}</span>
          </div>
          {!p.inSlot && <LockActions {...p} lock={l} />}
          <RowError ha={p.ha} entityId={l.entityId} what={`change ${l.name}`} />
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useState } from "react";
import type { UseHaResult } from "@/lib/use-ha";

/** One write per device at a time: the row's controls go off while its write is in flight. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    async run(go: () => Promise<unknown>) {
      if (busy) return;
      setBusy(true);
      try {
        await go();
      } finally {
        setBusy(false);
      }
    },
  };
}

/** A failed write, in plain words: the upstream message can name a host, so it is never shown. */
export function RowError({ ha, entityId, what }: { ha: UseHaResult; entityId: string; what: string }) {
  if (!ha.actionErrors[entityId]) return null;
  return (
    <div role="alert" className="mt-1.5 flex items-start gap-2 text-[0.7rem] text-bad">
      <span className="min-w-0 flex-1">Couldn’t {what}. Try again.</span>
      <button
        type="button"
        onClick={() => ha.dismissActionError(entityId)}
        aria-label="Dismiss error"
        className="inline-flex items-center shrink-0 rounded px-1 min-h-11 md:min-h-0 text-ink-dim outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
      >
        ×
      </button>
    </div>
  );
}

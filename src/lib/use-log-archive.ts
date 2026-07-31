"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LogLine } from "@/lib/log-types";
import {
  EMPTY_STATS,
  archiveAvailable,
  clearArchive,
  enqueueLines,
  flushArchive,
  onArchiveChange,
  readStats,
  type ArchiveStats,
} from "@/lib/log-archive";

/**
 * Bridges the live stream to the archive: every line that reaches the console's
 * buffers is handed to IndexedDB exactly once per session, and the console gets
 * back a stats readout it can state plainly.
 *
 * The write is fire-and-forget by design. Nothing on /logs waits on the
 * archive, and an archive that fails to open (private mode, a blocked upgrade,
 * a full disk) degrades to exactly the console that existed before it — live
 * tracks, no history — rather than to a broken page.
 */

/**
 * Ceiling on the "already handed over" id set. Ids are stable within a session,
 * so this only needs to outlive the live buffer; past this many the set is
 * dropped and a few lines are re-offered, which the archive's content-derived
 * key deduplicates for free. Bounded memory beats perfect bookkeeping.
 */
const SEEN_CAP = 20_000;

export interface LogArchiveResult {
  stats: ArchiveStats;
  /** False when IndexedDB is unavailable — the UI hides the archive entirely. */
  available: boolean;
  clear: () => Promise<void>;
  clearing: boolean;
}

export function useLogArchive(lines: Record<string, LogLine[]>): LogArchiveResult {
  const available = archiveAvailable();
  const [stats, setStats] = useState<ArchiveStats>(EMPTY_STATS);
  const [clearing, setClearing] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  const refresh = useCallback(() => {
    if (!available) return;
    void readStats()
      .then(setStats)
      .catch(() => setStats(EMPTY_STATS));
  }, [available]);

  useEffect(() => {
    refresh();
    return onArchiveChange(refresh);
  }, [refresh]);

  // Hand over anything not yet offered. Runs on every render that changed the
  // buffers, which is already coalesced to one per frame by useLogStream's rAF.
  useEffect(() => {
    if (!available) return;
    const fresh: LogLine[] = [];
    for (const buffer of Object.values(lines)) {
      for (const line of buffer) {
        if (seen.current.has(line.id)) continue;
        seen.current.add(line.id);
        fresh.push(line);
      }
    }
    if (seen.current.size > SEEN_CAP) seen.current = new Set();
    enqueueLines(fresh);
  }, [lines, available]);

  // A tab closed mid-window would otherwise lose up to FLUSH_MS of lines.
  // `visibilitychange` rather than `beforeunload`: it is the one event mobile
  // Safari reliably fires when an app is backgrounded or swiped away.
  useEffect(() => {
    if (!available) return;
    function onHide() {
      if (document.visibilityState === "hidden") void flushArchive();
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [available]);

  const clear = useCallback(async () => {
    setClearing(true);
    try {
      await clearArchive();
      // Re-offering this session's lines after a purge would refill the archive
      // within one flush and make the control look broken.
      seen.current = new Set();
      for (const buffer of Object.values(lines)) {
        for (const line of buffer) seen.current.add(line.id);
      }
    } finally {
      setClearing(false);
    }
  }, [lines]);

  return { stats, available, clear, clearing };
}

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
 * Bridges the live stream to the archive: every line that reaches the console
 * is handed to IndexedDB exactly once per session, and the console gets back a
 * stats readout it can state plainly.
 *
 * The write is fire-and-forget by design. Nothing on /logs waits on the
 * archive, and an archive that fails to open (private mode, a blocked upgrade,
 * a full disk) degrades to exactly the console that existed before it — live
 * tracks, no history — rather than to a broken page.
 *
 * Ingestion is entirely off `useLogStream`'s `subscribe` channel, not its
 * rendered `lines`. `subscribe` fires from inside that hook's SSE handlers —
 * on every `seed` batch and every `line` event — the instant each is parsed,
 * independent of `bumpVersion` and NOT gated by `document.visibilityState`.
 * That is what makes persistence independent of paint: a tab hidden, sent new
 * lines, and closed without ever being refocused still has those lines
 * archived, because this path never waited on a render to see them. See
 * `subscribe`'s own doc comment on `LogStreamResult` for the full reasoning.
 *
 * No client-side dedup runs here on purpose, and an earlier revision of this
 * file that had one (a `Set<string>` of already-offered `LogLine.id`s, shared
 * across a render-state path and this arrival path) is why: `subscribe` hands
 * over each physical `seed`/`line` event exactly once, so there is nothing to
 * re-offer in the first place, and `LogLine.id` is unsafe to key a "seen"
 * check on regardless — it is a per-demuxer counter that restarts at 0 on
 * every attach (see this repo's CLAUDE.md), so a container removed and later
 * re-added to the floor gets a fresh demuxer whose first line is `l0` again,
 * colliding with the PREVIOUS attach's `l0`. A `seen` set keyed on `id` would
 * read that as "already offered" and silently drop a physically different
 * line — worse than a harmless duplicate, an actual loss. The archive's own
 * key is content-derived (`archiveKey` in log-archive.ts) precisely to avoid
 * this; do not add an id-based prefilter back as an "optimization" in front
 * of it.
 */

export interface LogArchiveResult {
  stats: ArchiveStats;
  /** False when IndexedDB is unavailable — the UI hides the archive entirely. */
  available: boolean;
  clear: () => Promise<void>;
  clearing: boolean;
}

export function useLogArchive(
  subscribe: (fn: (lines: LogLine[]) => void) => () => void,
): LogArchiveResult {
  const available = archiveAvailable();
  const [stats, setStats] = useState<ArchiveStats>(EMPTY_STATS);
  const [clearing, setClearing] = useState(false);

  // `setStats` is a render. It must not fire while the tab is hidden, or the
  // exact perf regression `useLogStream` exists to avoid (LogTrack/LogRow
  // re-rendering, ANSI re-parsing on every arrival) comes back in through
  // this side door: ingestion below no longer waits for a render, so a flush
  // — and therefore an archive-change notify — can now happen while hidden,
  // which was never possible before this fix (the old design only ingested
  // from the rendered `lines` value, so nothing downstream of it could fire
  // while hidden either). `statsDirtyRef` defers the refresh until
  // visibility returns, mirroring the shape of useLogStream's own
  // `dirtyRef`/`scheduleRender` pattern — implemented independently in this
  // file, not by touching that one.
  const statsDirtyRef = useRef(false);

  const refresh = useCallback(() => {
    if (!available) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      statsDirtyRef.current = true;
      return;
    }
    void readStats()
      .then(setStats)
      .catch(() => setStats(EMPTY_STATS));
  }, [available]);

  useEffect(() => {
    refresh();
    return onArchiveChange(refresh);
  }, [refresh]);

  // The one moment a hidden tab is allowed to render the stats readout:
  // coming back into view. One catch-up refresh for the whole hidden
  // stretch, not one per buffered flush.
  useEffect(() => {
    if (!available) return;
    function onVisible() {
      if (document.visibilityState === "visible" && statsDirtyRef.current) {
        statsDirtyRef.current = false;
        refresh();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [available, refresh]);

  // The render-independent ingestion path — see the module doc comment above
  // for why this is the only path and why it needs no dedup of its own.
  // `subscribe` is a stable reference (useCallback with no deps in
  // useLogStream), so this effect subscribes once for the hook's lifetime
  // and is not re-created on selection changes or reconnects.
  useEffect(() => {
    if (!available) return;
    return subscribe(enqueueLines);
  }, [subscribe, available]);

  // A tab closed mid-window would otherwise lose up to FLUSH_MS of lines.
  // `visibilitychange` rather than `beforeunload`: it is the one event mobile
  // Safari reliably fires when an app is backgrounded or swiped away.
  //
  // The two listeners are NOT interchangeable, despite both meaning "flush
  // now". `onVisibilityHidden` only flushes on the hidden transition — it
  // also fires on the *reverse* transition (returning to the tab), which must
  // NOT trigger a flush of a possibly-empty queue on every focus. `onPageHide`
  // flushes unconditionally: pagehide means the page is being torn down, full
  // stop, and must not be gated on `document.visibilityState === "hidden"`.
  // That gate used to be shared across both listeners, which silently
  // defeated the entire reason pagehide is here — the mobile Safari case this
  // comment already names is exactly the one where a swipe-away can fire
  // pagehide before (or without ever firing) a visibilitychange to hidden, so
  // requiring "already hidden" skipped the flush on the one browser this
  // listener exists for.
  useEffect(() => {
    if (!available) return;
    function onVisibilityHidden() {
      if (document.visibilityState === "hidden") void flushArchive();
    }
    function onPageHide() {
      void flushArchive();
    }
    document.addEventListener("visibilitychange", onVisibilityHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [available]);

  const clear = useCallback(async () => {
    setClearing(true);
    try {
      await clearArchive();
      // Nothing to re-arm here: unlike the old buffer-rescanning design, this
      // ingestion path never re-offers a line it has already handed over, so
      // a purge can't be immediately refilled by lines already on screen —
      // only genuinely new arrivals reach `enqueueLines` from this point on.
    } finally {
      setClearing(false);
    }
  }, []);

  return { stats, available, clear, clearing };
}

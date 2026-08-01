"use client";

import { useState } from "react";
import useSWR from "swr";
import { Pin, PinOff, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, relativeTime } from "@/lib/format";
import { fetcher, postJson, type DiskUsageScan } from "@/lib/client";

/**
 * PINNED folders (G5): the owner marks a media folder (or anything else) from
 * the CONTENTS drill-down and it stays listed here with its current size,
 * scanned on demand through the SAME cached path endpoint the drill-down
 * itself uses (/api/resources/contents) — there is no separate "pin size"
 * scanner, just a read of `.usedBytes` off that response. Pin state itself is
 * config.json's pinnedFolders (see config.ts), mutated via POST
 * /api/resources/pins.
 */

const PINS_KEY = "/api/resources/pins";

interface PinsResponse {
  pinnedFolders: string[];
}

/** Shared pin/unpin state — SWR's own cache dedupes this across every
 *  PinToggleButton + PinnedFoldersPanel instance mounted at once, so this
 *  costs one network request no matter how many rows render it. */
export function usePins() {
  const { data, mutate } = useSWR<PinsResponse>(PINS_KEY, fetcher, { revalidateOnFocus: false });
  const pinned = data?.pinnedFolders ?? [];

  async function toggle(path: string): Promise<void> {
    const action = pinned.includes(path) ? "unpin" : "pin";
    const result = (await postJson(PINS_KEY, { path, action })) as PinsResponse;
    await mutate(result, false);
  }

  return { pinned, toggle, isPinned: (p: string) => pinned.includes(p) };
}

/** Pin/unpin affordance for a single directory row — used both on the CONTENTS
 *  drill-down's folder rows and nowhere else, but kept generic (just a path)
 *  so any future folder listing could reuse it. */
export function PinToggleButton({ path, className }: { path: string; className?: string }) {
  const { isPinned, toggle } = usePins();
  const pinned = isPinned(path);
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setBusy(true);
    try {
      await toggle(path);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-pressed={pinned}
      title={pinned ? `Unpin ${path}` : `Pin ${path} — track its size on the DISK tab without re-drilling into it`}
      className={cn(
        "h-11 w-11 md:h-7 md:w-7 flex items-center justify-center shrink-0 rounded-md cursor-pointer transition-colors",
        pinned ? "text-accent hover:text-accent/80" : "text-ink-faint hover:text-ink hover:bg-panel-2",
        busy && "opacity-50 pointer-events-none",
        className,
      )}
    >
      <Pin size={13} fill={pinned ? "currentColor" : "none"} />
    </button>
  );
}

function PinnedRow({ path, onUnpin }: { path: string; onUnpin: () => void }) {
  const key = `/api/resources/contents?path=${encodeURIComponent(path)}`;
  const { data: scan, isLoading, error, mutate } = useSWR<DiskUsageScan>(key, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 0,
    keepPreviousData: true,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [unpinning, setUnpinning] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const fresh = await fetcher(`${key}&refresh=1`);
      await mutate(fresh, false);
    } catch {
      // surfaced via the row's own error state below on next read
    } finally {
      setRefreshing(false);
    }
  }

  async function handleUnpin() {
    setUnpinning(true);
    try {
      onUnpin();
    } finally {
      setUnpinning(false);
    }
  }

  return (
    <div className="flex items-center gap-2.5 min-h-11 md:min-h-8 px-3 py-1.5 border-b border-line/50 last:border-0">
      <span className="font-mono text-[0.75rem] break-all flex-1 min-w-0" title={path}>
        {path}
      </span>
      <span className="font-mono text-[0.75rem] text-ink w-20 text-right shrink-0">
        {isLoading && !scan ? "…" : error && !scan ? <span className="text-warn/80">error</span> : scan ? formatBytes(scan.usedBytes) : "—"}
      </span>
      {scan && (
        <span className="microlabel shrink-0 hidden sm:inline">{relativeTime(scan.scannedAt)}</span>
      )}
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        title="Rescan"
        className="h-11 w-11 md:h-7 md:w-7 flex items-center justify-center text-ink-faint hover:text-ink cursor-pointer shrink-0 rounded-md hover:bg-panel-2"
      >
        <RotateCw size={13} className={refreshing ? "animate-spin" : ""} />
      </button>
      <button
        type="button"
        onClick={handleUnpin}
        disabled={unpinning}
        title="Unpin"
        className="h-11 w-11 md:h-7 md:w-7 flex items-center justify-center text-ink-faint hover:text-bad cursor-pointer shrink-0 rounded-md hover:bg-panel-2"
      >
        <PinOff size={13} />
      </button>
    </div>
  );
}

export function PinnedFoldersPanel() {
  const { pinned, toggle } = usePins();

  return (
    <div className="panel overflow-hidden">
      <div className="microlabel px-3 py-2 border-b border-line">PINNED</div>
      {pinned.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-ink-dim text-xs">
            Pin a folder from CONTENTS below to track its size here — media folders and anything else worth watching
            without re-drilling into it every time.
          </p>
        </div>
      ) : (
        pinned.map((p) => <PinnedRow key={p} path={p} onUnpin={() => void toggle(p)} />)
      )}
    </div>
  );
}

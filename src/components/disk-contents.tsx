"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronRight, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PinToggleButton } from "@/components/disk-pinned";
import { LargestFilesSection, DuplicatesSection } from "@/components/disk-scan-jobs";
import { cn } from "@/lib/utils";
import { formatBytes, relativeTime } from "@/lib/format";
import { fetcher, useDiskUsage, refreshDiskUsage, type DiskUsageScan } from "@/lib/client";

/**
 * CONTENTS panel for one HOST DISK row (G5): the depth-0 breakdown is the
 * disk group's own scan (useDiskUsage/refreshDiskUsage, unchanged — same
 * cache and rescan behaviour as before this file existed), and any listed
 * directory can be entered from there, arbitrarily deep, via
 * /api/resources/contents. `stack` holds the absolute host paths visited so
 * far; stack.length === 0 means "at the disk group's root". Each folder row
 * also carries a pin affordance, and the currently open path feeds the
 * largest-files/duplicates opt-in scans below the listing.
 */

const CONTENTS_RAMP = ["#134e4a", "#0f766e", "#0d9488", "#14b8a6"];
const NEUTRAL_FILL = "var(--color-line-bright)";

interface ContentsRow {
  key: string;
  label: string;
  bytes: number;
  fill: string;
  badge?: "mount" | "file";
  title?: string;
  path?: string;
  isDir?: boolean;
}

function contentsRows(scan: DiskUsageScan): ContentsRow[] {
  const rows: ContentsRow[] = scan.entries.map((e, i) => ({
    key: `${e.kind}-${e.name}`,
    label: e.name,
    bytes: e.bytes,
    fill: CONTENTS_RAMP[i % CONTENTS_RAMP.length],
    badge: e.kind === "mount" || e.kind === "file" ? e.kind : undefined,
    path: e.path,
    isDir: e.kind === "dir",
  }));
  if (scan.otherBytes > 0) rows.push({ key: "other", label: "other", bytes: scan.otherBytes, fill: NEUTRAL_FILL });
  // Two distinct, honestly-labeled buckets for the remainder — never both at once (see
  // DiskUsageScan's docstring): permission-denied space is NOT "filesystem overhead".
  if (scan.unreadableBytes > 0)
    rows.push({
      key: "unreadable",
      label: `unreadable · ${scan.deniedCount} paths denied`,
      bytes: scan.unreadableBytes,
      fill: NEUTRAL_FILL,
      title: "not readable as the dashboard's unprivileged user",
    });
  if (scan.unaccountedBytes > 0)
    rows.push({
      key: "unaccounted",
      label: "unaccounted (filesystem overhead)",
      bytes: scan.unaccountedBytes,
      fill: NEUTRAL_FILL,
    });
  return rows;
}

function pathKey(absolutePath: string): string {
  return `/api/resources/contents?path=${encodeURIComponent(absolutePath)}`;
}

function basename(absolutePath: string): string {
  const parts = absolutePath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? absolutePath;
}

export function DiskContentsPanel({ label }: { label: string }) {
  const [stack, setStack] = useState<string[]>([]);
  const atRoot = stack.length === 0;
  const currentPath = stack[stack.length - 1] ?? null;

  const { data: rootScan, isLoading: rootLoading } = useDiskUsage(atRoot ? label : null);
  const dirKey = !atRoot && currentPath ? pathKey(currentPath) : null;
  const {
    data: dirScan,
    isLoading: dirLoading,
    mutate: mutateDir,
    error: dirError,
  } = useSWR<DiskUsageScan>(dirKey, fetcher, { revalidateOnFocus: false, refreshInterval: 0, keepPreviousData: true });

  const scan = atRoot ? rootScan : dirScan;
  const isLoading = atRoot ? rootLoading : dirLoading;

  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);

  async function handleRescan() {
    setRescanning(true);
    setRescanError(null);
    try {
      if (atRoot) {
        await refreshDiskUsage(label);
      } else if (dirKey) {
        const fresh = await fetcher(`${dirKey}&refresh=1`);
        await mutateDir(fresh, false);
      }
    } catch (e) {
      setRescanError(e instanceof Error ? e.message : "rescan failed");
    } finally {
      setRescanning(false);
    }
  }

  if (isLoading && !scan) {
    return (
      <div className="py-2 space-y-1">
        <div className="microlabel">scanning contents…</div>
        <div className="text-ink-faint text-xs">large drives can take a few minutes</div>
      </div>
    );
  }

  if (!atRoot && dirError && !scan) {
    return (
      <div className="py-2 space-y-1">
        <div className="microlabel !text-warn/80">could not scan this path</div>
        <div className="text-ink-faint text-xs">{dirError instanceof Error ? dirError.message : "unknown error"}</div>
        <button type="button" onClick={() => setStack([])} className="text-xs text-accent hover:underline cursor-pointer">
          Back to root
        </button>
      </div>
    );
  }

  if (!scan) {
    return <div className="py-2 text-ink-faint text-xs">no contents data</div>;
  }

  const rows = contentsRows(scan);
  const maxBytes = Math.max(1, ...rows.map((r) => r.bytes));
  const scanRoot = scan.path ?? currentPath ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          <button
            type="button"
            onClick={() => setStack([])}
            disabled={atRoot}
            className={cn(
              "microlabel px-1 -mx-1 rounded",
              atRoot ? "!text-accent cursor-default" : "hover:text-ink cursor-pointer",
            )}
          >
            CONTENTS
          </button>
          {stack.map((p, i) => (
            <span key={p} className="flex items-center gap-1 min-w-0">
              <ChevronRight size={11} className="text-ink-faint shrink-0" aria-hidden />
              <button
                type="button"
                onClick={() => setStack((s) => s.slice(0, i + 1))}
                disabled={i === stack.length - 1}
                title={p}
                className={cn(
                  "font-mono text-[0.68rem] px-1 -mx-1 rounded truncate max-w-[10rem]",
                  i === stack.length - 1 ? "text-accent cursor-default" : "text-ink-dim hover:text-ink cursor-pointer",
                )}
              >
                {basename(p)}
              </button>
            </span>
          ))}
        </div>
        {scan.deniedCount > 0 && (
          <div className="microlabel !text-warn/80">{Math.round(100 - scan.readablePct)}% of used space not readable</div>
        )}
      </div>

      <div className="h-5 rounded-md overflow-hidden flex gap-[2px] bg-line">
        {rows.map((r) => {
          const pct = scan.usedBytes > 0 ? (r.bytes / scan.usedBytes) * 100 : 0;
          const showLabel = pct >= 9;
          return (
            <div
              key={r.key}
              title={r.title ?? `${r.label} · ${formatBytes(r.bytes)}`}
              className="h-full flex items-center justify-center px-1 overflow-hidden"
              style={{ width: `${pct}%`, background: r.fill }}
            >
              {showLabel && <span className="text-[0.625rem] font-medium truncate text-ink">{r.label}</span>}
            </div>
          );
        })}
      </div>

      <div className="divide-y divide-line/50">
        {rows.map((r) => {
          const bar = (
            <div className="hidden sm:block w-32 md:w-40 h-1.5 rounded-full bg-panel-2 overflow-hidden shrink-0">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, (r.bytes / maxBytes) * 100)}%`, background: "var(--color-accent-dim)" }}
              />
            </div>
          );
          const sizeLabel = (
            <span className="font-mono text-[0.75rem] text-ink w-20 text-right shrink-0">{formatBytes(r.bytes)}</span>
          );

          if (r.isDir && r.path) {
            const rowPath = r.path;
            return (
              <div key={r.key} className="flex items-center gap-1 min-h-11 md:min-h-8">
                <button
                  type="button"
                  onClick={() => setStack((s) => [...s, rowPath])}
                  title={`Open ${r.label}`}
                  className="flex-1 min-w-0 flex items-center gap-2.5 py-1.5 -ml-1 pl-1 text-left cursor-pointer hover:bg-panel-2/60 rounded"
                >
                  <ChevronRight size={12} className="text-ink-faint shrink-0" aria-hidden />
                  <span className="font-mono text-[0.75rem] break-all flex-1 min-w-0">{r.label}</span>
                  {bar}
                  {sizeLabel}
                </button>
                <PinToggleButton path={rowPath} />
              </div>
            );
          }

          return (
            <div key={r.key} title={r.title} className="flex items-center gap-2.5 min-h-11 md:min-h-8 py-1.5">
              <span className="font-mono text-[0.75rem] break-all flex-1 min-w-0">
                {r.badge && <span className="microlabel mr-1.5">{r.badge}</span>}
                {r.label}
              </span>
              {bar}
              {sizeLabel}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        <div className="microlabel">
          scanned {relativeTime(scan.scannedAt)} · {(scan.durationMs / 1000).toFixed(1)}s
        </div>
        <Button size="sm" variant="ghost" disabled={rescanning} onClick={handleRescan}>
          <RotateCw size={12} className={rescanning ? "animate-spin" : ""} /> Rescan
        </Button>
      </div>

      {rescanError && <div className="microlabel !text-warn/80">{rescanError}</div>}

      {(scan.partial || scan.error) && (
        <div className="microlabel !text-warn/80">{scan.error ?? "partial scan — some data may be incomplete"}</div>
      )}

      {scanRoot && (
        <div className="pt-2 border-t border-line/60 space-y-3">
          <LargestFilesSection scanRoot={scanRoot} />
          <DuplicatesSection scanRoot={scanRoot} />
        </div>
      )}
    </div>
  );
}

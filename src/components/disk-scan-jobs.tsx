"use client";

import { useState } from "react";
import useSWR from "swr";
import { Copy, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, relativeTime } from "@/lib/format";
import { fetcher, postJson, ApiError } from "@/lib/client";

/**
 * Largest-files and duplicates job UIs (G5) — opt-in, per-path recursive
 * scans of whatever the CONTENTS drill-down currently has open. Both share
 * one job-polling shape; disk-scan.ts is a server-only module (node:fs,
 * node:crypto) so its types are mirrored locally here rather than imported,
 * the same reasoning resources/page.tsx documents for HistoryApiResponse.
 */

type JobKind = "largest-files" | "duplicates";
type JobState = "running" | "done" | "error";
type CapReason = "entries" | "time" | null;

interface LargestFileEntry {
  path: string;
  bytes: number;
  mtime: number;
}
interface LargestFilesResult {
  root: string;
  files: LargestFileEntry[];
  entriesScanned: number;
  capHit: CapReason;
  durationMs: number;
}
interface DuplicateGroup {
  size: number;
  hash: string;
  files: string[];
  wastedBytes: number;
}
interface DuplicatesResult {
  root: string;
  groups: DuplicateGroup[];
  totalWastedBytes: number;
  entriesScanned: number;
  filesHashed: number;
  capHit: CapReason;
  hashCapHit: boolean;
  durationMs: number;
}

interface ScanJobDto<T> {
  id: string;
  kind: JobKind;
  root: string;
  state: JobState;
  progress: { entriesScanned: number };
  result: T | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

function capLabel(capHit: CapReason): string | null {
  if (capHit === "entries") return "stopped at 100k entries scanned — results are a floor, not a census";
  if (capHit === "time") return "stopped at the 60s scan budget — results are a floor, not a census";
  return null;
}

/** Polls only once `watch` is true (i.e. after the owner has actually started
 *  a job from this panel) — an idle CONTENTS row should not carry a 800ms
 *  poll it never asked for. Polls fast while running, stops once settled. */
function useScanJob<T>(kind: JobKind, watch: boolean) {
  const key = watch ? `/api/resources/scan/${kind}` : null;
  const { data, mutate } = useSWR<ScanJobDto<T>>(key, fetcher, {
    refreshInterval: (latest) => (latest && latest.state === "running" ? 800 : 0),
    revalidateOnFocus: false,
  });
  return { job: data ?? null, mutate };
}

export function LargestFilesSection({ scanRoot }: { scanRoot: string }) {
  const [watching, setWatching] = useState(false);
  const { job, mutate } = useScanJob<LargestFilesResult>("largest-files", watching);
  const [startError, setStartError] = useState<string | null>(null);
  const running = job?.state === "running";
  const showResults = job && job.root === scanRoot && job.state !== "running";

  async function handleStart() {
    setStartError(null);
    setWatching(true);
    try {
      await postJson("/api/resources/scan/largest-files", { root: scanRoot });
      await mutate();
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : "could not start scan");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="microlabel">LARGEST FILES</div>
        {!running && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleStart}
            title="Recursively walks everything under this path — can take up to a minute on a large tree"
          >
            <Search size={12} /> Find largest files
          </Button>
        )}
      </div>

      {running && job && job.root === scanRoot && (
        <div className="flex items-center gap-2 text-ink-dim text-xs">
          <Loader2 size={12} className="animate-spin shrink-0" aria-hidden />
          <span className="font-mono tabular-nums">
            {job.progress.entriesScanned.toLocaleString()} entries scanned…
          </span>
        </div>
      )}

      {startError && <div className="microlabel !text-warn/80">{startError}</div>}
      {showResults && job.state === "error" && (
        <div className="microlabel !text-warn/80">{job.error ?? "scan failed"}</div>
      )}

      {showResults && job.state === "done" && job.result && (
        <div className="space-y-2">
          {capLabel(job.result.capHit) && (
            <div className="microlabel !text-warn/80">{capLabel(job.result.capHit)}</div>
          )}
          {job.result.files.length === 0 ? (
            <div className="px-1 py-3 text-center text-ink-faint text-xs">no files found under this path</div>
          ) : (
            <div className="divide-y divide-line/50">
              {job.result.files.map((f) => (
                <div key={f.path} className="flex items-center gap-2.5 min-h-11 md:min-h-8 py-1.5">
                  <span className="font-mono text-[0.72rem] break-all flex-1 min-w-0" title={f.path}>
                    {f.path}
                  </span>
                  <span className="microlabel shrink-0 hidden sm:inline">{relativeTime(f.mtime)}</span>
                  <span className="font-mono text-[0.75rem] text-ink w-20 text-right shrink-0">
                    {formatBytes(f.bytes)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="microlabel">
            {job.result.entriesScanned.toLocaleString()} entries scanned · {(job.result.durationMs / 1000).toFixed(1)}s
          </div>
        </div>
      )}
    </div>
  );
}

export function DuplicatesSection({ scanRoot }: { scanRoot: string }) {
  const [watching, setWatching] = useState(false);
  const { job, mutate } = useScanJob<DuplicatesResult>("duplicates", watching);
  const [startError, setStartError] = useState<string | null>(null);
  const running = job?.state === "running";
  const showResults = job && job.root === scanRoot && job.state !== "running";

  async function handleStart() {
    setStartError(null);
    setWatching(true);
    try {
      await postJson("/api/resources/scan/duplicates", { root: scanRoot });
      await mutate();
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : "could not start scan");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="microlabel">DUPLICATES</div>
        {!running && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleStart}
            title="Reads file contents — heavy on spinning disks"
          >
            <Copy size={12} /> Find duplicates
          </Button>
        )}
      </div>
      <p className="text-ink-faint text-[0.68rem] leading-relaxed">
        Reads file contents to compare them — heavy on spinning disks. Results are{" "}
        <span className="text-ink-dim">likely duplicates (size + partial content match)</span>, never a certainty.
      </p>

      {running && job && job.root === scanRoot && (
        <div className="flex items-center gap-2 text-ink-dim text-xs">
          <Loader2 size={12} className="animate-spin shrink-0" aria-hidden />
          <span className="font-mono tabular-nums">
            {job.progress.entriesScanned.toLocaleString()} entries scanned…
          </span>
        </div>
      )}

      {startError && <div className="microlabel !text-warn/80">{startError}</div>}
      {showResults && job.state === "error" && (
        <div className="microlabel !text-warn/80">{job.error ?? "scan failed"}</div>
      )}

      {showResults && job.state === "done" && job.result && (
        <div className="space-y-2">
          {capLabel(job.result.capHit) && (
            <div className="microlabel !text-warn/80">{capLabel(job.result.capHit)}</div>
          )}
          {job.result.hashCapHit && (
            <div className="microlabel !text-warn/80">
              stopped hashing early — more duplicates may exist than shown
            </div>
          )}
          <div className="font-mono text-sm text-ink">
            {formatBytes(job.result.totalWastedBytes)}{" "}
            <span className="text-ink-faint text-xs font-sans">
              likely wasted across {job.result.groups.length} group{job.result.groups.length === 1 ? "" : "s"}
            </span>
          </div>
          {job.result.groups.length === 0 ? (
            <div className="px-1 py-3 text-center text-ink-faint text-xs">no likely duplicates found under this path</div>
          ) : (
            <div className="space-y-2">
              {job.result.groups.map((g) => (
                <div key={`${g.size}-${g.hash}`} className="border border-line/60 rounded-md p-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <span className="microlabel">
                      {formatBytes(g.size)} each · {g.files.length} copies
                    </span>
                    <span className="font-mono text-xs text-ink">{formatBytes(g.wastedBytes)} wasted</span>
                  </div>
                  <div className="space-y-0.5">
                    {g.files.map((f) => (
                      <div key={f} className="font-mono text-[0.68rem] text-ink-dim break-all">
                        {f}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="microlabel">
            {job.result.entriesScanned.toLocaleString()} entries scanned ·{" "}
            {job.result.filesHashed.toLocaleString()} files hashed · {(job.result.durationMs / 1000).toFixed(1)}s
          </div>
        </div>
      )}
    </div>
  );
}

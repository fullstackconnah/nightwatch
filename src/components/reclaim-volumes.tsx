/* THESIS: an orphan volume is silent — nothing fails when it just sits there — so this
   panel exists to make silence visible: name it, size it, offer to remove it.
   OWN-WORLD: nightwatch console — .panel hairlines, mono data, microlabels, danger tint
   only on the one destructive control.
   HONEST DATA: "nothing to reclaim" is real copy when every volume is attached; a volume
   whose size the proxy hasn't reported reads "size unknown", never a fabricated 0. */
"use client";

import { useState } from "react";
import { formatBytes, relativeTime } from "@/lib/format";
import { PruneAction, ReclaimedBanner, useDiskReclaim, type PruneResult } from "@/components/reclaim-shared";

export function ReclaimVolumesPanel() {
  const { data, error, isLoading, mutate } = useDiskReclaim();
  const [lastResult, setLastResult] = useState<PruneResult | null>(null);

  function handlePruned(result: PruneResult) {
    setLastResult(result);
    mutate();
  }

  if (isLoading && !data) {
    return (
      <div className="panel p-4">
        <div className="microlabel mb-3">ORPHAN VOLUMES</div>
        <div className="text-xs text-ink-faint">Checking disk usage…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel p-4">
        <div className="microlabel mb-3">ORPHAN VOLUMES</div>
        <div className="text-xs text-bad">Could not reach Docker to check reclaimable space.</div>
        <div className="text-[0.7rem] text-ink-faint mt-1">
          {error instanceof Error ? error.message : String(error)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { orphans, orphanBytes } = data.volumes;

  return (
    <div className="panel p-4">
      <div className="microlabel mb-3">ORPHAN VOLUMES</div>

      <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="font-mono text-base text-ink">{formatBytes(orphanBytes, 1)}</div>
          <div className="microlabel mt-0.5">
            {orphans.length} orphan volume{orphans.length === 1 ? "" : "s"}
          </div>
        </div>
        <PruneAction
          target="volumes"
          itemLabel={`orphan volume${orphans.length === 1 ? "" : "s"}`}
          count={orphans.length}
          bytes={orphanBytes}
          onPruned={handlePruned}
        />
      </div>

      {lastResult && <ReclaimedBanner result={lastResult} onDismiss={() => setLastResult(null)} />}

      {orphans.length === 0 ? (
        <div className="text-xs text-ink-faint pt-2 border-t border-line">
          Nothing to reclaim — every volume is attached to a container.
        </div>
      ) : (
        <>
          <div className="hidden md:block border-t border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {["Name", "Size", "Created"].map((h) => (
                    <th key={h} className="microlabel text-left px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orphans.map((v) => (
                  <tr key={v.name} className="border-b border-line/50 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs max-w-64 truncate" title={v.name}>
                      {v.name}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-dim">
                      {v.size != null ? formatBytes(v.size, 0) : <span className="text-ink-faint">size unknown</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-faint whitespace-nowrap">
                      {v.created ? relativeTime(v.created) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-1 pt-2 border-t border-line">
            {orphans.map((v) => (
              <div
                key={v.name}
                className="flex items-center justify-between gap-2 min-h-11 py-1.5 border-b border-line/50 last:border-0"
              >
                <span className="font-mono text-xs break-all flex-1 min-w-0">{v.name}</span>
                <div className="flex flex-col items-end shrink-0">
                  <span className="font-mono text-xs text-ink-dim">
                    {v.size != null ? formatBytes(v.size, 0) : <span className="text-ink-faint">unknown</span>}
                  </span>
                  <span className="text-[0.7rem] text-ink-faint">{v.created ? relativeTime(v.created) : "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

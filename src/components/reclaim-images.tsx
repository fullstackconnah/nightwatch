/* THESIS: the /images page tells you what's tagged and running; this panel tells you
   what isn't and can safely go — reclaimable space is a number you act on, not just read.
   OWN-WORLD: nightwatch console — .panel hairlines, mono data, microlabels, teal-free
   (this panel is all danger/neutral, never accent — there is no "live signal" here).
   HONEST DATA: "nothing to reclaim" is real copy, not a blank table; build cache is shown
   but never offered as a button, because BUILD=0 on the socket-proxy makes pruning it
   impossible without a new, deliberate scope grant (see docker.ts's DiskReclaimSnapshot). */
"use client";

import { useState } from "react";
import { formatBytes, relativeTime } from "@/lib/format";
import { PruneAction, ReclaimedBanner, useDiskReclaim, type PruneResult } from "@/components/reclaim-shared";

export function ReclaimImagesPanel() {
  const { data, error, isLoading, mutate } = useDiskReclaim();
  const [lastResult, setLastResult] = useState<PruneResult | null>(null);

  function handlePruned(result: PruneResult) {
    setLastResult(result);
    mutate();
  }

  if (isLoading && !data) {
    return (
      <div className="panel p-4">
        <div className="microlabel mb-3">RECLAIMABLE</div>
        <div className="text-xs text-ink-faint">Checking disk usage…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel p-4">
        <div className="microlabel mb-3">RECLAIMABLE</div>
        <div className="text-xs text-bad">Could not reach Docker to check reclaimable space.</div>
        <div className="text-[0.7rem] text-ink-faint mt-1">
          {error instanceof Error ? error.message : String(error)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { dangling, danglingBytes, unusedBytes } = data.images;
  // Tagged-but-unused images are real reclaimable space, but the prune action here
  // only ever removes dangling (untagged) images — naming something isn't something
  // this dashboard undoes on your behalf. Surfaced as a note, not folded into the
  // headline figure, so the number above the button always matches what it will do.
  const additionalUnused = Math.max(0, unusedBytes - danglingBytes);
  const buildCache = data.buildCacheBytes;

  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
        <div className="microlabel">RECLAIMABLE</div>
        {buildCache != null && buildCache > 0 && (
          <div
            className="microlabel"
            title="BUILD=0 on the socket-proxy — pruning build cache needs a new, deliberate scope grant"
          >
            build cache <span className="font-mono normal-case tracking-normal">{formatBytes(buildCache, 1)}</span> ·
            read-only
          </div>
        )}
      </div>

      <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="font-mono text-base text-ink">{formatBytes(danglingBytes, 1)}</div>
          <div className="microlabel mt-0.5">
            {dangling.length} dangling image{dangling.length === 1 ? "" : "s"}
          </div>
        </div>
        <PruneAction
          target="images"
          itemLabel={`dangling image${dangling.length === 1 ? "" : "s"}`}
          count={dangling.length}
          bytes={danglingBytes}
          onPruned={handlePruned}
        />
      </div>

      {lastResult && <ReclaimedBanner result={lastResult} onDismiss={() => setLastResult(null)} />}

      {dangling.length === 0 ? (
        <div className="text-xs text-ink-dim pt-2 border-t border-line">
          Nothing to reclaim — no dangling images right now.
        </div>
      ) : (
        <>
          <div className="hidden md:block border-t border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {["Image", "Size", "Created"].map((h) => (
                    <th key={h} className="microlabel text-left px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dangling.map((img) => (
                  <tr key={img.id} className="border-b border-line/50 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">
                      <span className="text-ink-faint">{img.id.replace("sha256:", "").slice(0, 12)}</span>{" "}
                      <span className="text-ink-faint">(untagged)</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-dim">{formatBytes(img.size, 0)}</td>
                    <td className="px-3 py-2 text-xs text-ink-faint whitespace-nowrap">
                      {relativeTime(img.created * 1000)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-1 pt-2 border-t border-line">
            {dangling.map((img) => (
              <div
                key={img.id}
                className="flex items-center justify-between gap-2 min-h-11 py-1.5 border-b border-line/50 last:border-0"
              >
                <span className="font-mono text-xs text-ink-faint truncate">
                  {img.id.replace("sha256:", "").slice(0, 12)} (untagged)
                </span>
                <div className="flex flex-col items-end shrink-0">
                  <span className="font-mono text-xs text-ink-dim">{formatBytes(img.size, 0)}</span>
                  <span className="text-[0.7rem] text-ink-faint">{relativeTime(img.created * 1000)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {additionalUnused > 0 && (
        <div className="mt-3 pt-3 border-t border-line/60 text-[0.7rem] text-ink-dim">
          Another {formatBytes(additionalUnused, 1)} sits in tagged images no container is using — pruning here never
          removes a named image, so clear those by hand if you want the space back.
        </div>
      )}
    </div>
  );
}

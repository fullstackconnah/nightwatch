/* THESIS: a prune button is the one place this app asks "are you sure" — no browser
   confirm(), an inline two-step that names exactly what's about to disappear.
   OWN-WORLD: nightwatch console — .panel hairlines, mono data, button-danger tint,
   real copy over generic alerts. Shared by reclaim-images.tsx and reclaim-volumes.tsx
   so the confirm flow and the /api/docker/disk-usage poll are defined exactly once. */
"use client";

import { useState } from "react";
import useSWR from "swr";
import { RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetcher, postJson } from "@/lib/client";
import { formatBytes } from "@/lib/format";
import type { DiskReclaimSnapshot, PruneResult, PruneTarget } from "@/lib/docker";

export function useDiskReclaim(refreshMs = 30000) {
  return useSWR<DiskReclaimSnapshot>("/api/docker/disk-usage", fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

async function prune(target: PruneTarget): Promise<PruneResult> {
  return (await postJson("/api/docker/prune", { target })) as PruneResult;
}

type PruneStep = "idle" | "confirm" | "busy";

/**
 * Danger action + explicit inline confirm, per DESIGN.md's Touch-Equivalent and
 * button-danger rules — never a browser confirm(). Three states in one control:
 * idle button -> inline "prune N, reclaim ~X? confirm/cancel" -> busy spinner.
 * The caller owns what happens after a successful prune (refetch + a "reclaimed"
 * banner) via onPruned.
 */
export function PruneAction({
  target,
  itemLabel,
  count,
  bytes,
  onPruned,
}: {
  target: PruneTarget;
  itemLabel: string;
  count: number;
  bytes: number;
  onPruned: (result: PruneResult) => void;
}) {
  const [step, setStep] = useState<PruneStep>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setStep("busy");
    setError(null);
    try {
      const result = await prune(target);
      setStep("idle");
      onPruned(result);
    } catch (e) {
      setStep("idle");
      setError(e instanceof Error ? e.message : "prune failed");
    }
  }

  if (step === "confirm") {
    return (
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <span className="text-xs text-ink-dim">
          Prune {count} {itemLabel}, reclaim ~<span className="font-mono">{formatBytes(bytes, 1)}</span>?
        </span>
        <Button size="sm" variant="ghost" onClick={() => setStep("idle")}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" onClick={handleConfirm}>
          Confirm
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="danger"
        disabled={count === 0 || step === "busy"}
        onClick={() => setStep("confirm")}
      >
        {step === "busy" ? (
          <RotateCw size={12} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Trash2 size={12} />
        )}
        Prune {itemLabel}
      </Button>
      {error && <span className="text-[0.7rem] text-bad text-right">{error}</span>}
    </div>
  );
}

/** The post-prune receipt: real copy, mono bytes, dismissible. Shown once, above
 *  the (now-refreshed) list, until the user dismisses it or prunes again. */
export function ReclaimedBanner({ result, onDismiss }: { result: PruneResult; onDismiss: () => void }) {
  return (
    <div className="mb-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
      <span className="text-xs text-ink-dim">
        Reclaimed <span className="font-mono text-ok">{formatBytes(result.reclaimedBytes, 1)}</span> across{" "}
        {result.deleted.length} item{result.deleted.length === 1 ? "" : "s"}.
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-[0.7rem] text-ink-faint hover:text-ink shrink-0 min-h-11 md:min-h-0 px-1"
      >
        dismiss
      </button>
    </div>
  );
}

export type { DiskReclaimSnapshot, PruneResult, PruneTarget };

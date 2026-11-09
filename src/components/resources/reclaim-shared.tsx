/* THESIS: a prune button is the one place this app asks "are you sure" — no browser
   confirm(), an inline two-step that names exactly what's about to disappear.
   OWN-WORLD: nightwatch console — .panel hairlines, mono data, button-danger tint,
   real copy over generic alerts. Shared by the /docker chores
   so the confirm flow and the /api/docker/disk-usage poll are defined exactly once. */
"use client";

import { useState } from "react";
import useSWR from "swr";
import { RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirmFocus } from "@/components/use-confirm-focus";
import { fetcher, postJson } from "@/lib/client";
import { formatBytes } from "@/lib/format";
import { reclaimPrefix } from "@/lib/docker-chores";
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
 * The caller owns what happens after a successful prune (refetch + the size count-down
 * summary) via onPruned.
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
  bytes: number | null;
  onPruned: (result: PruneResult) => void;
}) {
  const [step, setStep] = useState<PruneStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const { trigger, cancel, onKeyDown } = useConfirmFocus(step === "confirm", () => setStep("idle"));

  async function handleConfirm() {
    setStep("busy");
    setError(null);
    try {
      const result = await prune(target);
      setStep("idle");
      onPruned(result);
    } catch (e) {
      setStep("idle");
      setError(e instanceof Error ? e.message : "Couldn't prune — try again");
    }
  }

  if (step === "confirm") {
    return (
      <div key="confirm" onKeyDown={onKeyDown} className="nw-confirm flex items-center gap-2 flex-wrap justify-end">
        <span className="text-xs text-ink-dim">
          Prune {count} {itemLabel}
          {bytes == null ? (
            "? Sizes still arriving. Can't be undone."
          ) : (
            <>
              , reclaim {reclaimPrefix(target) || "~"}<span className="font-mono">{formatBytes(bytes, 1)}</span>? Can&apos;t be undone.
            </>
          )}
        </span>
        <Button autoFocus size="sm" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" onClick={handleConfirm}>
          Yes, prune
        </Button>
      </div>
    );
  }

  // Outlined at rest: nothing is wrong until a prune is offered, so red waits for the confirm step.
  return (
    <div className="flex flex-col items-end gap-1 max-md:items-stretch">
      <Button
        ref={trigger}
        size="sm"
        variant="outline"
        data-feature={`prune-${target}`}
        aria-label={`Prune ${itemLabel}`}
        className="min-w-24 max-md:w-full"
        disabled={count === 0 || step === "busy"}
        onClick={() => setStep("confirm")}
      >
        {step === "busy" ? (
          <RotateCw size={12} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Trash2 size={12} />
        )}
        {step === "busy" ? "Pruning…" : "Prune"}
      </Button>
      {error && (
        <span key="error" data-kind="error" className="nw-confirm dk-failed">
          {error}
          <Button size="sm" variant="outline" onClick={handleConfirm}>
            Retry
          </Button>
        </span>
      )}
    </div>
  );
}

export type { DiskReclaimSnapshot, PruneResult, PruneTarget };

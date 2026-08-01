/* THESIS: a delete button is the second place this app asks "are you sure" — same
   inline two-step as reclaim-shared.tsx's PruneAction, scaled down to an icon
   trigger because this one lives inside a dense table/card row instead of a
   panel footer. No browser confirm(), and an in-use image never reaches the
   confirm step at all — it renders disabled with the owning container named.
   OWN-WORLD: nightwatch console — button-danger tint only once a delete is
   actually offered, ghost otherwise; 44px touch dropping to icon-size on pointer. */
"use client";

import { useState } from "react";
import { RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/client";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ImageDeleteResult {
  imageId: string;
  label: string;
  freedBytes: number;
  deleted: string[];
}

type Step = "idle" | "confirm" | "busy";

const ICON_BUTTON = "h-11 w-11 md:h-7 md:w-7";

export function ImageDeleteAction({
  imageId,
  label,
  size,
  inUse,
  usedBy,
  onDeleted,
}: {
  imageId: string;
  /** What the confirm/error copy calls this row — a tag ref or "<id> (untagged)". */
  label: string;
  size: number;
  inUse: boolean;
  usedBy: string[];
  onDeleted: (result: ImageDeleteResult) => void;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  if (inUse) {
    const owners = usedBy.length > 0 ? usedBy.join(", ") : "a container";
    return (
      <Button
        size="icon"
        variant="ghost"
        disabled
        title={`In use by ${owners} — stop ${usedBy.length === 1 ? "it" : "them"} first`}
        aria-label={`Can't delete ${label} — in use by ${owners}`}
        className={ICON_BUTTON}
      >
        <Trash2 size={13} />
      </Button>
    );
  }

  async function handleConfirm() {
    setStep("busy");
    setError(null);
    try {
      const res = await fetch(`/api/docker/images/${encodeURIComponent(imageId)}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(body.error || `HTTP ${res.status}`, res.status);
      setStep("idle");
      onDeleted({ imageId, label, freedBytes: size, deleted: (body.deleted as string[] | undefined) ?? [] });
    } catch (e) {
      setStep("idle");
      setError(e instanceof Error ? e.message : "delete failed");
    }
  }

  if (step === "confirm") {
    return (
      <div className="flex items-center gap-2 justify-end flex-wrap">
        <span className="text-[0.7rem] text-ink-dim whitespace-nowrap">
          Delete, free ~<span className="font-mono">{formatBytes(size, 1)}</span>?
        </span>
        <Button size="sm" variant="ghost" className="h-11 md:h-7" onClick={() => setStep("idle")}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" className="h-11 md:h-7" onClick={() => void handleConfirm()}>
          Confirm
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="icon"
        variant="ghost"
        disabled={step === "busy"}
        onClick={() => setStep("confirm")}
        aria-label={`Delete ${label}`}
        title={`Delete ${label}`}
        className={cn(ICON_BUTTON, "hover:text-bad hover:bg-bad/10")}
      >
        {step === "busy" ? (
          <RotateCw size={13} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Trash2 size={13} />
        )}
      </Button>
      {error && <span className="text-[0.65rem] text-bad text-right max-w-[12rem]">{error}</span>}
    </div>
  );
}

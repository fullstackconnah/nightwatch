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
import { useConfirmFocus } from "@/components/use-confirm-focus";
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

/** The disabled "image is in use" button, shared by /images (icon-only) and the open watchlist row (`text` adds a visible label). */
export function ImageInUseButton({
  label,
  usedBy,
  text,
  describedBy,
  className,
}: {
  label: string;
  usedBy: string[];
  text?: string;
  describedBy?: string;
  className?: string;
}) {
  const owners = usedBy.length > 0 ? usedBy.join(", ") : "a container";
  return (
    <Button
      size={text ? "sm" : "icon"}
      variant={text ? "outline" : "ghost"}
      disabled
      title={`In use by ${owners} — remove ${usedBy.length > 1 ? "them" : "it"} first`}
      aria-label={text ? `${text}, unavailable: in use by ${owners}` : `Can't delete ${label} — in use by ${owners}`}
      aria-describedby={describedBy}
      className={text ? className : ICON_BUTTON}
    >
      <Trash2 size={text ? 12 : 13} aria-hidden className={text ? "hidden md:block" : undefined} />
      {text && <span className="truncate">{text}</span>}
    </Button>
  );
}

export function ImageDeleteAction({
  imageId,
  label,
  size,
  inUse,
  usedBy,
  text,
  onDeleted,
}: {
  imageId: string;
  /** What the confirm/error copy calls this row — a tag ref or "<id> (untagged)". */
  label: string;
  size: number;
  inUse: boolean;
  usedBy: string[];
  /** A visible label ("Delete") for roomy rows; without it the trigger is an icon. */
  text?: string;
  onDeleted: (result: ImageDeleteResult) => void;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const { trigger, cancel, onKeyDown } = useConfirmFocus(step === "confirm", () => setStep("idle"));

  if (inUse) return <ImageInUseButton label={label} usedBy={usedBy} text={text} />;

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
      setError(e instanceof Error ? e.message : "Couldn't delete — try again");
    }
  }

  if (step === "confirm") {
    return (
      <div key="confirm" onKeyDown={onKeyDown} className="nw-confirm flex items-center gap-2 justify-end flex-wrap">
        <span className="text-[0.7rem] text-ink-dim">
          Delete {label}, free ~<span className="font-mono">{formatBytes(size, 1)}</span>? Can&apos;t be undone.
        </span>
        <Button autoFocus size="sm" variant="ghost" className="h-11 md:h-7" onClick={cancel}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" className="h-11 md:h-7" onClick={() => void handleConfirm()}>
          Yes, delete
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        ref={trigger}
        size={text ? "sm" : "icon"}
        variant={text ? "outline" : "ghost"}
        data-feature="delete-image"
        disabled={step === "busy"}
        onClick={() => setStep("confirm")}
        aria-label={`Delete ${label}`}
        title={`Delete ${label}`}
        className={cn(!text && ICON_BUTTON)}
      >
        {step === "busy" ? (
          <RotateCw size={13} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Trash2 size={13} />
        )}
        {text && (step === "busy" ? "Deleting…" : text)}
      </Button>
      {error && (
        <span key="error" data-kind="error" className="nw-confirm dk-failed">
          {error}
          <Button size="sm" variant="outline" onClick={() => void handleConfirm()}>
            Retry
          </Button>
        </span>
      )}
    </div>
  );
}

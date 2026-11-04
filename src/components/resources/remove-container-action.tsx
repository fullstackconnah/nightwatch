/* THESIS: removing a container is the one write here that can't be undone, so it
   gets the same inline two-step as image-delete-action.tsx (idle outline button,
   then a sentence with "Yes, remove" as the only danger-coloured control). The
   idle button is deliberately not red: nothing is wrong until it is offered. */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeConfirmText } from "@/lib/container-remove";

type Step = "idle" | "confirm" | "busy" | "error";

const DOCKER_LIST = "/docker?find=containers";

/** Without `onRemoved` (the detail page) a success returns to the Docker list; a list row passes its own. */
export function RemoveContainerAction({ id, name, onRemoved }: { id: string; name: string; onRemoved?: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");
  const [gone, setGone] = useState(false);

  async function remove() {
    setStep("busy");
    setGone(false);
    try {
      const res = await fetch(`/api/docker/containers/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 404) setGone(true);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (onRemoved) onRemoved();
      else router.push(DOCKER_LIST);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove it. Try again.");
      setStep("error");
    }
  }

  if (step === "confirm") {
    return (
      <div className="flex items-center gap-2 flex-wrap max-md:basis-full">
        <span className="text-xs text-ink-dim">{removeConfirmText(name)}</span>
        <Button size="sm" variant="ghost" onClick={() => setStep("idle")}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" onClick={() => void remove()}>
          Yes, remove
        </Button>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div role="alert" className="flex items-center gap-2 flex-wrap max-md:basis-full">
        <span className="text-xs text-ink">{error}</span>
        {gone ? (
          <Link href={DOCKER_LIST} className="inline-flex h-11 items-center px-3 text-xs text-ink underline underline-offset-2 md:h-7">
            Back to Docker
          </Link>
        ) : (
          <Button size="sm" variant="outline" onClick={() => void remove()}>
            Retry
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setStep("idle")}>
          Cancel
        </Button>
      </div>
    );
  }

  const busy = step === "busy";
  return (
    <Button variant="outline" data-feature="remove" disabled={busy} aria-busy={busy} onClick={() => setStep("confirm")}>
      {busy ? <RotateCw size={13} className="animate-spin motion-reduce:animate-none" /> : <Trash2 size={13} />}{" "}
      {busy ? "Removing…" : "Remove"}
    </Button>
  );
}

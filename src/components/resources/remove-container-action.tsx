/* THESIS: removing a container is the one write here that can't be undone, so it
   gets the same inline two-step as image-delete-action.tsx (idle outline button,
   then a sentence with "Yes, remove" as the only danger-coloured control). The
   idle button is deliberately not red: nothing is wrong until it is offered. */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeConfirmText } from "@/lib/container-remove";

type Step = "idle" | "confirm" | "busy" | "error";

export function RemoveContainerAction({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");

  async function remove() {
    setStep("busy");
    try {
      const res = await fetch(`/api/docker/containers/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      router.push("/containers");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove it. Try again.");
      setStep("error");
    }
  }

  if (step === "confirm") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
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
      <div role="alert" className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-ink">{error}</span>
        <Button size="sm" variant="outline" onClick={() => void remove()}>
          Retry
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setStep("idle")}>
          Cancel
        </Button>
      </div>
    );
  }

  const busy = step === "busy";
  return (
    <Button variant="outline" disabled={busy} aria-busy={busy} onClick={() => setStep("confirm")}>
      {busy ? <RotateCw size={13} className="animate-spin motion-reduce:animate-none" /> : <Trash2 size={13} />}{" "}
      {busy ? "Removing…" : "Remove"}
    </Button>
  );
}

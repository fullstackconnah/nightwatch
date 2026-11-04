"use client";

/* The service band: only when Orchestra has something to say. An ok service with every lane read says nothing
   (the page sentence carries it); lanes it could not read get the partial band. Only the status sentence sits in
   the live region, so a 10 s poll that changes nothing announces nothing. */

import Link from "next/link";
import { StaleTag } from "@/components/kiosk/kiosk-stale-tag";
import { bandView, partialBand } from "@/lib/orchestra-view";
import type { OrchestraSnapshot } from "@/lib/types/orchestra";

export function OrchestraBand({ snap, lastAge }: { snap: OrchestraSnapshot; lastAge?: string }) {
  if (snap.status === "ok") {
    const partial = partialBand(snap.orchestrators);
    if (!partial) return null;
    return (
      <section aria-label="Orchestra service" data-band="partial" className="panel p-4">
        <p role="status" aria-live="polite" className="text-sm text-ink">
          {partial}
        </p>
      </section>
    );
  }
  if (snap.status !== "unauthorized" && snap.status !== "unreachable") return null;
  const b = bandView(snap.status, { detail: snap.detail, lastAge });
  const band = snap.status === "unauthorized" ? "unauth" : b.stale ? "stale" : "error";
  return (
    <section aria-label="Orchestra service" data-band={band} className="panel p-4 space-y-1">
      <div className="flex items-center gap-2">
        <span className={`dot ${b.dot}`} aria-hidden />
        <span className={`microlabel ${b.tone === "warn" ? "!text-warn" : "!text-bad"}`}>{b.label}</span>
        {b.stale && <StaleTag />}
      </div>
      <p role="status" aria-live="polite" className="text-sm text-ink">
        {b.sentence}
      </p>
      <p className="text-[0.7rem] text-ink-dim">
        {b.hint}
        {snap.status === "unauthorized" && (
          <>
            {" "}
            <Link href="/settings#access" className="inline-flex min-h-11 items-center text-accent hover:underline">
              Open settings
            </Link>
          </>
        )}
      </p>
      {b.detail && <p className="font-mono text-[0.65rem] text-ink-faint [overflow-wrap:anywhere]">{b.detail}</p>}
    </section>
  );
}

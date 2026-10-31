"use client";

/* The one service band: is Orchestra answering, and what is it saying. Only the status
   sentence sits in the live region, so a 10 s poll that changes nothing announces nothing. */

import Link from "next/link";
import { StaleTag } from "@/components/kiosk/kiosk-stale-tag";
import { relativeTime } from "@/lib/format";
import { bandView, okSentence } from "@/lib/orchestra-view";
import type { OrchestraSnapshot } from "@/lib/types/orchestra";

export function OrchestraBand({ snap, lastAge }: { snap: OrchestraSnapshot; lastAge?: string }) {
  if (snap.status === "ok") {
    const s = okSentence(snap.orchestrators);
    return (
      <section aria-label="Orchestra service" className="panel p-4 space-y-1">
        <div className="flex items-center gap-2">
          <span className="dot dot-running" aria-hidden />
          <p role="status" aria-live="polite" className="text-sm text-ink">
            {s.head}
            {s.stalled && (
              <>
                , <span className="text-warn">{s.stalled}</span>
              </>
            )}
            {s.tail}
          </p>
        </div>
        <div className="microlabel">checked {relativeTime(snap.fetchedAt)}</div>
      </section>
    );
  }
  if (snap.status !== "unauthorized" && snap.status !== "unreachable") return null;
  const b = bandView(snap.status, { detail: snap.detail, lastAge });
  return (
    <section aria-label="Orchestra service" className="panel p-4 space-y-1">
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

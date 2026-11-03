"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clock, type Tone } from "@/lib/home";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const DOT: Record<Tone, string> = {
  ok: "dot-running",
  warn: "dot-unhealthy",
  bad: "dot-dead",
  pending: "hm-dot-pending",
};

/** The one sentence: is it fine, and if not, what first. */
export function Answer({ tone, text }: { tone: Tone; text: string }) {
  return (
    <h1 className="hm-answer" data-feature="answer" data-tone={tone}>
      <span className={cn("dot", DOT[tone])} aria-hidden />
      <span>{text}</span>
    </h1>
  );
}

const STALE_REPORT_MS = 30_000; // 2 refreshes of the 15 s report poll
const STALE_CONTAINERS_MS = 10_000; // 2 refreshes of the 5 s container poll

function ageText(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

/**
 * One fixed 44 px slot (R1, OPEN-H3): the probe line, or the stale bar, or "Retry now".
 * It owns the 1 Hz clock, so a stale flip re-renders this slot and nothing else.
 */
export function StatusSlot({
  line,
  reportAt,
  containersAt,
  reportError,
  onReconnect,
  onRetry,
}: {
  line: string;
  /** ms of the last successful report / container fetch, null before the first. */
  reportAt: number | null;
  containersAt: number | null;
  reportError: boolean;
  onReconnect: () => void;
  onRetry: () => void;
}) {
  const now = useNow(true);
  const oldest = [
    reportAt !== null && now - reportAt > STALE_REPORT_MS ? reportAt : null,
    containersAt !== null && now - containersAt > STALE_CONTAINERS_MS ? containersAt : null,
  ].reduce<number | null>((a, t) => (t === null ? a : a === null ? t : Math.min(a, t)), null);

  let body: React.ReactNode;
  if (reportError) {
    body = (
      <>
        <p className="hm-status-text text-ink-dim">The box did not answer. It asks again every 15 s.</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw size={12} aria-hidden /> Retry now
        </Button>
      </>
    );
  } else if (oldest !== null && now > 0) {
    body = (
      <>
        <p className="hm-status-text text-ink" role="status">
          Not live. Showing {clock(oldest)}, {ageText(now - oldest)} old.
        </p>
        <Button variant="outline" size="sm" onClick={onReconnect}>
          <RotateCw size={12} aria-hidden /> Reconnect
        </Button>
      </>
    );
  } else {
    body = <p className="hm-status-text font-mono text-xs text-ink-dim">{line}</p>;
  }
  return (
    <div className="hm-status" data-stale={oldest !== null && !reportError ? "" : undefined}>
      {body}
    </div>
  );
}

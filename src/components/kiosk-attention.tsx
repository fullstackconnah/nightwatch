"use client";

/* THESIS: "One Thing Needs You" is the inverse of every other kiosk panel —
   those report continuously (counts, gauges, a running clock); this one
   reports NOTHING until getAttention() finds a real deviation, then shows
   exactly one plain sentence. Silence is the payload: a wall tablet that is
   quiet 99% of the time is what makes the 1% legible at a glance. Composed
   fresh in nightwatch's own hairline/mono/microlabel vocabulary (matching
   KioskHealth's attention-strip treatment) rather than a generic toast or
   banner component, and sourced from the public /kiosk/api/attention route —
   see that route and src/lib/attention.ts for the probes and the honesty
   rules ("errors in a probe skip it silently; a probe never fabricates"). */

import { useEffect, useState } from "react";
import useSWR from "swr";
import { AlertTriangle } from "lucide-react";
import { fetcher } from "@/lib/client";
import type { AttentionResult } from "@/lib/attention";
import { formatUptime } from "@/lib/format";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;

export function KioskAttentionCard() {
  const { data } = useSWR<AttentionResult>("/kiosk/api/attention", fetcher, {
    refreshInterval: POLL_MS,
    keepPreviousData: true,
  });

  const active = data?.status === "attention";

  // One-time fade/settle on arrival, never on re-poll while already showing —
  // `entered` flips true the frame after a card first appears and stays true
  // for as long as it's visible, so a routine 30s refresh of the SAME
  // condition never re-triggers the entrance. Skipped visually (not
  // functionally) under prefers-reduced-motion via the motion-reduce classes
  // below, rather than branching the whole effect on a media query.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (active && !entered) {
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    if (!active && entered) setEntered(false);
  }, [active, entered]);

  // Silence is the feature: loading, an unreachable route, and a genuinely
  // quiet host all render nothing on the wall. There is no error state for
  // this card on purpose.
  if (!data || data.status !== "attention") return null;

  const sinceMs = data.since ? Date.parse(data.since) : NaN;
  const sinceLabel = !isNaN(sinceMs) ? formatUptime(Math.max(0, (Date.now() - sinceMs) / 1000)) : null;

  const severityText = data.severity === "bad" ? "text-bad" : "text-warn";
  const severityBorder = data.severity === "bad" ? "border-bad/40 bg-bad/5" : "border-warn/40 bg-warn/5";

  return (
    <div
      role="status"
      className={cn(
        "panel border px-4 py-3 flex w-full max-w-md items-start gap-3",
        "transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none",
        severityBorder,
        severityText,
        entered
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-1 motion-reduce:opacity-100 motion-reduce:translate-y-0",
      )}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-sm font-semibold text-ink">{data.headline}</div>
        {data.detail && <div className="text-xs text-ink-dim">{data.detail}</div>}
      </div>
      {sinceLabel && (
        <span className="shrink-0 rounded-md bg-panel-2 px-2 py-1 font-mono text-xs text-ink-dim tabular-nums">
          for {sinceLabel}
        </span>
      )}
    </div>
  );
}

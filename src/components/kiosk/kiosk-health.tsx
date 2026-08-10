"use client";

import { ShieldAlert } from "lucide-react";
import { useKioskHealth } from "@/lib/kiosk-client";
import { cn } from "@/lib/utils";

const COUNT_ITEMS: { key: "running" | "restarting" | "paused" | "stopped"; label: string; dot: string }[] = [
  { key: "running", label: "running", dot: "dot-running" },
  { key: "restarting", label: "restarting", dot: "dot-restarting" },
  { key: "paused", label: "paused", dot: "dot-paused" },
  { key: "stopped", label: "stopped", dot: "dot-stopped" },
];

/**
 * Container health counts with status dots, plus the attention strip — the
 * Threshold Rule in practice: the strip only renders when something real is
 * wrong (dead or unhealthy > 0), and its colour follows the worse of the two
 * (bad for dead, warn for unhealthy-only) rather than defaulting to a fixed
 * "alert" tint. Ambient-calm (nothing wrong) renders no strip at all.
 */
export function KioskHealth() {
  const { data, error, isLoading } = useKioskHealth(5000);

  if (error) {
    return (
      <div className="panel px-6 py-4 text-bad text-sm text-center max-w-md">
        Containers unreachable — {error.message}
      </div>
    );
  }

  const dead = data?.dead ?? 0;
  const unhealthy = data?.unhealthy ?? 0;
  const severity = dead > 0 ? "bad" : unhealthy > 0 ? "warn" : null;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {COUNT_ITEMS.map(({ key, label, dot }) => (
          <div key={key} className="flex items-center gap-1.5 font-mono text-sm text-ink-dim">
            <span className={cn("dot", dot)} />
            {isLoading && !data ? "…" : (data?.[key] ?? 0)}
            <span className="microlabel">{label}</span>
          </div>
        ))}
      </div>

      {severity && (
        <div
          role="status"
          className={cn(
            "panel border px-4 py-2 flex items-center gap-2 text-sm font-mono",
            severity === "bad" ? "border-bad/40 bg-bad/5 text-bad" : "border-warn/40 bg-warn/5 text-warn",
          )}
        >
          <ShieldAlert size={15} />
          {dead > 0 && <span>{dead} dead</span>}
          {dead > 0 && unhealthy > 0 && <span aria-hidden="true">·</span>}
          {unhealthy > 0 && <span>{unhealthy} unhealthy</span>}
        </div>
      )}
    </div>
  );
}

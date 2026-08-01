"use client";

import { ArrowDown, ArrowUp, HardDrive, MemoryStick } from "lucide-react";
import { Gauge, Meter } from "@/components/charts";
import { useKioskVitals } from "@/lib/kiosk-client";
import { formatBytes, formatRate } from "@/lib/format";

/** Ambient host vitals — the same CPU/RAM/disk/net numbers VitalsStrip shows
 *  on the logged-in overview, reframed for glanceability from across a room:
 *  fewer panels, bigger gauge, one disk (the busiest/root one) rather than
 *  the full list. Sourced from the public /kiosk/api/vitals route. */
export function KioskVitals() {
  const { data: host, error, isLoading } = useKioskVitals(5000);

  if (error) {
    return (
      <div className="panel px-6 py-5 text-bad text-sm text-center max-w-md">
        Host metrics unavailable — {error.message}
      </div>
    );
  }

  const primaryDisk = host?.disk?.[0];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 w-full max-w-3xl">
      <div className="panel px-3 py-4 flex flex-col items-center gap-2">
        <Gauge percent={host?.cpu.percent ?? 0} label="cpu" size={84} />
      </div>

      <div className="panel px-4 py-4 flex flex-col justify-center gap-2">
        <div className="microlabel flex items-center gap-1.5">
          <MemoryStick size={11} /> memory
        </div>
        <Meter percent={host?.memory.percent ?? 0} />
        <div className="font-mono text-xs text-ink-dim">
          {host ? `${formatBytes(host.memory.used)} / ${formatBytes(host.memory.total)}` : isLoading ? "…" : "—"}
        </div>
      </div>

      <div className="panel px-4 py-4 flex flex-col justify-center gap-2">
        <div className="microlabel flex items-center gap-1.5">
          <HardDrive size={11} /> disk
        </div>
        {primaryDisk ? (
          <>
            <Meter percent={primaryDisk.percent} warnAt={85} badAt={95} />
            <div className="font-mono text-xs text-ink-dim">
              {formatBytes(primaryDisk.used, 0)} / {formatBytes(primaryDisk.total, 0)}
            </div>
          </>
        ) : (
          <div className="font-mono text-xs text-ink-faint">{isLoading ? "…" : "—"}</div>
        )}
      </div>

      <div className="panel px-4 py-4 flex flex-col justify-center gap-1.5">
        <div className="microlabel">network</div>
        <div className="flex items-center gap-2 font-mono text-sm text-accent">
          <ArrowDown size={13} /> {host ? formatRate(host.network.rxPerSec) : "…"}
        </div>
        <div className="flex items-center gap-2 font-mono text-sm text-blue">
          <ArrowUp size={13} /> {host ? formatRate(host.network.txPerSec) : "…"}
        </div>
      </div>
    </div>
  );
}

"use client";

import { ArrowDown, ArrowUp, HardDrive, MemoryStick } from "lucide-react";
import { Gauge, Meter } from "@/components/charts";
import { KioskSpark, KioskSparkPair } from "@/components/kiosk-spark";
import { useKioskVitalsHistory } from "@/lib/kiosk-client";
import { formatBytes, formatRate } from "@/lib/format";

/** Ambient host vitals — the same CPU/RAM/disk/net numbers VitalsStrip shows
 *  on the logged-in overview, reframed for glanceability from across a room:
 *  fewer panels, bigger gauge, one disk (the busiest/root one) rather than
 *  the full list. Sourced from the public /kiosk/api/vitals route. */
export function KioskVitals() {
  const { data: host, error, isLoading, history } = useKioskVitalsHistory(5000);

  if (error) {
    // useKioskVitalsHistory types `error` as `unknown` (it just forwards
    // whatever useKioskVitals/SWR produced) — narrow it the same way
    // drive-health.tsx/kiosk-hub.tsx already do elsewhere in this app.
    return (
      <div className="panel px-6 py-5 text-bad text-sm text-center max-w-md">
        Host metrics unavailable — {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  const primaryDisk = host?.disk?.[0];
  const cpuHistory = history.map((h) => h.cpu);
  const rxHistory = history.map((h) => h.rx);
  const txHistory = history.map((h) => h.tx);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 w-full max-w-3xl">
      <div className="panel px-3 py-4 flex flex-col items-center gap-2">
        <Gauge percent={host?.cpu.percent ?? 0} label="cpu" size={84} />
        {/* The gauge says "now"; this says "the last four minutes" — that
            pairing is the whole reason to add it. 22px keeps it an ambient
            trend, not a second reading: glance mode is a fixed-height band
            that CLIPS rather than scrolls, so every extra pixel here is a
            pixel some other panel's control or figure loses. */}
        <KioskSpark values={cpuHistory} max={100} height={22} glideMs={5000} label="cpu" className="text-accent" />
      </div>

      {/* Memory and disk stay meter-only — no spark added here, and that's a
          decision, not an oversight. Both are capacity readings (how much of
          a FIXED whole is used), and Meter is already the right idiom for a
          fraction of a whole; a trend line under a capacity bar would be
          decoration, not information, the way the CPU spark actually is
          under a point-in-time gauge. */}
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
        {/* 26px: a hair taller than the CPU spark since it has two mirrored
            halves to read instead of one, still short enough that this
            panel's height stays governed by the two rate figures above it,
            not by the chart underneath them. */}
        <KioskSparkPair rx={rxHistory} tx={txHistory} height={26} glideMs={5000} className="mt-0.5" />
      </div>
    </div>
  );
}

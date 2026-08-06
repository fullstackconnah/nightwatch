"use client";

import { ArrowDown, ArrowUp, HardDrive, MemoryStick } from "lucide-react";
import { Gauge, Meter } from "@/components/charts";
import { KioskSpark, KioskSparkPair } from "@/components/kiosk-spark";
import { useKioskVitalsHistory } from "@/lib/kiosk-client";
import { formatBytes, formatRate } from "@/lib/format";

/** Ambient host vitals — the same CPU/RAM/disk/net numbers VitalsStrip shows
 *  on the logged-in overview, reframed for glanceability from across a room:
 *  fewer panels, bigger gauge, one disk (the busiest/root one) rather than
 *  the full list. Sourced from the public /kiosk/api/vitals route.
 *
 *  `compact` is the glance-carousel fit: the band is a fixed-height CLIPPING
 *  box (132px, 88px on short viewports — kiosk-surface.tsx's heightClassName)
 *  and the four-panel grid below measures 177px, so in a carousel pane its
 *  whole bottom row was cut off (reported on production 2026-08-06). The
 *  compact strip is one panel, one row, ~70px worst case: CPU keeps its
 *  number+trend pairing (percent + spark), memory/disk stay meters, network
 *  keeps both rates and the mirrored spark pair — nothing loses its reading,
 *  everything loses its padding. */
export function KioskVitals({ compact = false }: { compact?: boolean }) {
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

  if (compact) {
    // Every figure is digits-0 in compact ("7 GiB", "797 KiB/s") — the full
    // grid keeps one decimal, but at this size the decimal is the first
    // thing to push a unit out of its cell, and a number that keeps its
    // unit beats one that keeps its decimal.
    //
    // The charts show the last MINUTE only and do not glide (owner's call,
    // 2026-08-06): the full grid's 4-minute window and perpetual travel are
    // an ambient display for a panel you stand at; in the rotating band the
    // pane is on screen for ~12s, where "what just happened" is the whole
    // question and four permanently-moving lines are noise. glideMs={0}
    // disables the glide at the source (see kiosk-spark.tsx) — the lines
    // still redraw when a poll lands, they just don't animate between
    // samples.
    const windowSamples = Math.ceil(60_000 / 5_000); // last 60s at the hook's 5s poll
    const cpuRecent = cpuHistory.slice(-windowSamples);
    const rxRecent = rxHistory.slice(-windowSamples);
    const txRecent = txHistory.slice(-windowSamples);
    return (
      // justify-between with every cell flex-none: each reading and each
      // chart is its own fixed-width block (the charts MUST be — a flexing
      // spark re-scales its x-axis with the pane, so the same minute of
      // data would read as a different shape in different rotations), and
      // the leftover pane width becomes breathing room between cells
      // instead of stretch nobody asked for.
      <div className="panel flex w-full max-w-2xl items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex flex-none flex-col gap-1">
          <div className="microlabel">cpu</div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-mono text-sm text-ink">
              {host ? `${Math.round(host.cpu.percent)}%` : isLoading ? "…" : "—"}
            </span>
            <div className="w-20">
              <KioskSpark values={cpuRecent} max={100} height={16} glideMs={0} label="cpu" className="text-accent" />
            </div>
          </div>
        </div>

        <div className="flex flex-none flex-col gap-1">
          <div className="microlabel flex items-center gap-1.5">
            <MemoryStick size={11} /> memory
          </div>
          <Meter percent={host?.memory.percent ?? 0} />
          <div className="font-mono text-[11px] text-ink-dim">
            {host ? `${formatBytes(host.memory.used, 0)} / ${formatBytes(host.memory.total, 0)}` : isLoading ? "…" : "—"}
          </div>
        </div>

        <div className="flex flex-none flex-col gap-1">
          <div className="microlabel flex items-center gap-1.5">
            <HardDrive size={11} /> disk
          </div>
          {primaryDisk ? (
            <>
              <Meter percent={primaryDisk.percent} warnAt={85} badAt={95} />
              <div className="font-mono text-[11px] text-ink-dim">
                {formatBytes(primaryDisk.used, 0)} / {formatBytes(primaryDisk.total, 0)}
              </div>
            </>
          ) : (
            <div className="font-mono text-[11px] text-ink-faint">{isLoading ? "…" : "—"}</div>
          )}
        </div>

        <div className="flex flex-none flex-col gap-1">
          <div className="microlabel">network</div>
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="flex items-center gap-1 text-accent">
              <ArrowDown size={11} className="shrink-0" /> {host ? `${formatBytes(host.network.rxPerSec, 0)}/s` : "…"}
            </span>
            <span className="flex items-center gap-1 text-blue">
              <ArrowUp size={11} className="shrink-0" /> {host ? `${formatBytes(host.network.txPerSec, 0)}/s` : "…"}
            </span>
          </div>
          <div className="w-28">
            <KioskSparkPair rx={rxRecent} tx={txRecent} height={14} glideMs={0} />
          </div>
        </div>
      </div>
    );
  }

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

/* THESIS: this GPU exists for one job — Jellyfin's hardware transcoding — so the page
reads as that pipeline: demand, then encoder, then the silicon's cost. It refuses the
four-stat-card GPU wall, where every number is the same size and none of them answer
"is hardware encoding actually working".
OWN-WORLD: nightwatch unchanged — #070b11 ground, .panel hairlines, one teal data hue,
Inter with mono numerals, 10px tracked microlabels. Colour beyond teal appears in exactly
two places, each earned by a real threshold rather than a mood: the thermal arc against
the card's slowdown limit, and the badge marking a stream that fell back to the CPU.
STORY: the reader learns whether hardware encoding is alive, what holds VRAM, how hot
the card runs, and whether any stream silently fell back to the CPU.
FIRST VIEWPORT: a verdict line (device, driver, live encode state), then a band pairing
a 140px thermal arc against a full-width 60s core-utilization area chart, then the VRAM
attribution bar.
FORM: pipeline band-stack, first on my ordered list; a precisely specified request inside
an established world, so shaped directly with no concept seed.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md */
"use client";

import type { GpuDevice, GpuUnavailableReason } from "@/lib/gpu-types";
import type { TranscodeStream, TranscodeUnavailableReason } from "@/lib/transcode-types";
import { Sparkline } from "@/components/charts";
import { ThermalGauge } from "@/components/thermal-gauge";
import { ResourceOverview, type OverviewModel, type OverviewSegment } from "@/components/resource-overview";
import { cn } from "@/lib/utils";
import { formatBitrate, formatBytes, formatPercent } from "@/lib/format";
import { useTelemetryStream, useTranscodes, type TelemetrySample } from "@/lib/client";

/** Last path segment of a process name, e.g. "/usr/lib/jellyfin-ffmpeg/ffmpeg" -> "ffmpeg". */
function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * Series of MEASURED values only. Ticks where the GPU was unreadable are dropped
 * rather than plotted as 0: a zero in the chart asserts the GPU was idle, which is a
 * different claim from "this could not be read". The chart carries no time axis, so
 * dropping a tick shortens the line instead of inventing a floor under it. Matters
 * in the mixed-state window right after a host reboot clears the driver mismatch.
 */
function measuredSeries(samples: TelemetrySample[], pick: (device: GpuDevice) => number | null): number[] {
  const out: number[] = [];
  for (const s of samples) {
    if (!s.gpu?.ok) continue;
    const device = s.gpu.devices[0];
    if (!device) continue;
    const v = pick(device);
    if (v !== null) out.push(v);
  }
  return out;
}

// Reused from the resources/page.tsx overview-fill convention (OVERVIEW_FILL_PRIMARY/
// SECONDARY/OTHER/TRACK) rather than inventing new hues.
const VRAM_FILL_RAMP = ["var(--color-accent-dim)", "#0f766e", "#0d9488"];
const VRAM_FILL_UNATTRIBUTED = "#2a3a50";
const VRAM_FILL_FREE = "var(--color-panel-2)";

function buildVramOverview(device: GpuDevice): OverviewModel {
  const segments: OverviewSegment[] = [];
  let processSum = 0;
  device.processes.forEach((p, i) => {
    processSum += p.memBytes;
    segments.push({
      key: p.containerId ?? `pid-${p.pid}`,
      label: p.containerName ?? basename(p.name),
      value: p.memBytes,
      fill: VRAM_FILL_RAMP[i % VRAM_FILL_RAMP.length],
      display: formatBytes(p.memBytes),
    });
  });
  // Deliberately not summed to memUsedBytes — driver overhead and graphics contexts
  // are not itemized by NVML, so the remainder is shown honestly rather than folded
  // into a process or silently rescaled away.
  const unattributed = Math.max(0, device.memUsedBytes - processSum);
  if (unattributed > 0) {
    segments.push({
      key: "unattributed",
      label: "unattributed",
      value: unattributed,
      fill: VRAM_FILL_UNATTRIBUTED,
      display: formatBytes(unattributed),
    });
  }
  const free = Math.max(0, device.memTotalBytes - device.memUsedBytes);
  segments.push({ key: "free", label: "free", value: free, fill: VRAM_FILL_FREE, display: formatBytes(free) });

  return {
    scale: device.memTotalBytes,
    segments,
    headline: `${formatBytes(device.memUsedBytes)} of ${formatBytes(device.memTotalBytes)}`,
    caption: "",
    figures: [
      { label: "used", value: formatBytes(device.memUsedBytes) },
      { label: "free", value: formatBytes(free) },
      { label: "total", value: formatBytes(device.memTotalBytes) },
      { label: "processes", value: String(device.processes.length) },
    ],
    caveat: "Unattributed covers driver, display, and graphics contexts NVML does not itemize per process.",
  };
}

function gpuUnavailableCopy(reason: GpuUnavailableReason): { headline: string; fix: string | null } {
  switch (reason) {
    case "no-binary":
      return {
        headline: "GPU access not enabled for this container",
        fix: "Uncomment the nvidia runtime block for the dashboard service in docker-compose.yml, then redeploy. See DEPLOY.md.",
      };
    case "driver-mismatch":
      return {
        headline: "Host driver and libraries are different versions",
        fix: "The loaded NVIDIA kernel module does not match the installed userspace libraries. Reboot 192.168.1.70 to resync them.",
      };
    case "no-device":
      return {
        headline: "No GPU reported",
        fix: "nvidia-smi ran but the container was handed no device. Check that NVIDIA_VISIBLE_DEVICES=all is set on the dashboard service, and that the host still lists the card in `lspci | grep -i vga`.",
      };
    case "error":
      return { headline: "GPU telemetry failed", fix: null };
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

/**
 * Same rule as the GPU states: name an action, not just a condition. `not-configured`
 * and `error` return no canned fix because their `detail` already carries the specific
 * one (the exact config.json entry, or the failure itself) and repeating it would just
 * put two sentences of the same instruction on screen.
 */
function transcodeUnavailableCopy(reason: TranscodeUnavailableReason): { headline: string; fix: string | null } {
  switch (reason) {
    case "not-configured":
      return { headline: "Jellyfin API key not configured", fix: null };
    case "unreachable":
      return {
        headline: "Jellyfin did not respond",
        fix: "Check the jellyfin container is running and that its URL in data/config.json is reachable from this container.",
      };
    case "unauthorized":
      return {
        headline: "Jellyfin rejected the API key",
        fix: "Regenerate the key in Jellyfin under Dashboard → API Keys, then update the jellyfin widget entry in data/config.json.",
      };
    case "error":
      return { headline: "Transcode telemetry failed", fix: null };
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function codecPath(s: TranscodeStream): string {
  if (s.videoFrom || s.videoTo) return `${s.videoFrom ?? "?"} → ${s.videoTo ?? "?"}`;
  if (s.audioFrom || s.audioTo) return `${s.audioFrom ?? "?"} → ${s.audioTo ?? "?"}`;
  return "—";
}

function streamBadge(s: TranscodeStream): { text: string; className: string; title?: string } {
  if (s.isVideoTranscode) {
    if (s.hardwareAccel) {
      return { text: (s.hardwareAccelType ?? "nvenc").toUpperCase(), className: "text-ok" };
    }
    return {
      text: "CPU",
      className: "text-warn",
      title: "Software fallback — hardware encoding is not being used for this video transcode",
    };
  }
  // DirectPlay, DirectStream (remux), or an audio-only transcode: no hardware/software
  // encode distinction applies, so this gets the quiet direct-play treatment.
  return { text: "DIRECT", className: "text-ink-faint" };
}

export default function GpuPage() {
  const { samples, status } = useTelemetryStream();
  const { data: tx } = useTranscodes(5000);

  const latest = samples[samples.length - 1];
  const gpu = latest?.gpu;
  const device: GpuDevice | undefined = gpu?.ok ? gpu.devices[0] : undefined;
  const sessions = device?.encoderSessions ?? null;

  const utilSeries = measuredSeries(samples, (d) => d.utilizationPct);
  const sessionSeries = measuredSeries(samples, (d) => d.encoderSessions);

  return (
    <div className="space-y-4 pb-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">GPU</h1>
        <p className="microlabel mt-0.5">hardware transcoding</p>
      </header>

      {/* a. verdict line — not a panel, real live state built from the actual snapshot */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="font-mono text-ink">{device?.name ?? "GPU"}</span>
        {gpu?.ok && <span className="font-mono text-ink-faint">driver {gpu.driverVersion}</span>}
        {/* Three states, not two: a null session count means the driver never reported
            encoder stats, which is not the same claim as a measured zero. Saying "idle"
            for both would put the page's least-supported guess in its most-read line. */}
        {device &&
          (sessions === null ? (
            <span className="text-ink-faint">encoder stats unavailable</span>
          ) : sessions > 0 ? (
            <span className="flex items-center gap-1.5">
              <span className="dot dot-running" />
              <span className="text-ink-dim">
                hardware encoding · {sessions} {sessions === 1 ? "session" : "sessions"}
              </span>
            </span>
          ) : (
            <span className="text-ink-dim">idle</span>
          ))}
        {status === "lost" && (
          <span className="microlabel !text-warn/80 shrink-0">connection lost — reconnecting</span>
        )}
      </div>

      {/* b/c/d/e — GPU hardware region: loading, transient-miss, unavailable, or populated */}
      {samples.length === 0 ? (
        <div className="panel p-4 text-xs text-ink-faint">reading GPU telemetry…</div>
      ) : !gpu ? (
        // gpu absent (not ok:false) this tick means the collector itself hasn't reported
        // yet — a transient miss, not a real unavailable result (see telemetry-types.ts).
        <div className="panel p-4 text-xs text-ink-faint">reading GPU telemetry…</div>
      ) : !gpu.ok ? (
        (() => {
          const copy = gpuUnavailableCopy(gpu.reason);
          return (
            <div className="panel p-4 space-y-2">
              <div className="text-sm text-warn font-medium">{copy.headline}</div>
              {copy.fix && <div className="text-xs text-ink-dim">{copy.fix}</div>}
              <div className="font-mono text-xs text-ink-dim">{gpu.detail}</div>
            </div>
          );
        })()
      ) : !device ? (
        <div className="panel p-4 space-y-2">
          <div className="text-sm text-warn font-medium">No GPU reported</div>
          <div className="text-xs text-ink-dim">nvidia-smi ran but found no device.</div>
        </div>
      ) : (
        <>
          {/* c. core + thermal band */}
          <div className="panel p-4">
            <div className="grid md:grid-cols-[auto_1fr] gap-6">
              <div className="flex flex-col items-center gap-3">
                <ThermalGauge tempC={device.tempC} maxC={device.tempMaxC} size={140} />
                <div className="flex gap-5">
                  <div className="text-center">
                    <div className="microlabel">FAN</div>
                    <div className="font-mono text-xs text-ink mt-0.5">
                      {device.fanPct != null ? `${device.fanPct}%` : "—"}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="microlabel">POWER</div>
                    <div className="font-mono text-xs text-ink mt-0.5">
                      {device.powerWatts != null ? `${device.powerWatts.toFixed(0)}W` : "—"}
                      {device.powerLimitWatts != null ? ` / ${device.powerLimitWatts.toFixed(0)}W` : ""}
                    </div>
                  </div>
                </div>
              </div>

              <div className="min-w-0">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="microlabel">CORE UTILIZATION</span>
                  <span className="font-mono text-sm text-ink">{formatPercent(device.utilizationPct, 0)}</span>
                </div>
                <Sparkline data={utilSeries} className="text-accent" height={72} />
                <div className="flex gap-6 mt-3 pt-3 border-t border-line">
                  <div>
                    <div className="microlabel">SM CLOCK</div>
                    <div className="font-mono text-xs text-ink mt-0.5">
                      {device.smClockMhz != null ? `${device.smClockMhz} MHz` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="microlabel" title="Memory-controller bandwidth utilization, not VRAM fill">
                      MEM CONTROLLER BANDWIDTH
                    </div>
                    <div className="font-mono text-xs text-ink mt-0.5">
                      {formatPercent(device.memUtilizationPct, 0)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* d. VRAM band */}
          <ResourceOverview title="VRAM" model={buildVramOverview(device)} />

          {/* e. encoder band — lower density than (c), no session ceiling implied */}
          <div className="panel p-4 space-y-3">
            <div className="microlabel">NVENC</div>
            <div className="flex items-end gap-6 flex-wrap">
              <div>
                <div className="font-mono text-xl text-ink">{sessions ?? "—"}</div>
                <div className="microlabel mt-0.5">sessions</div>
              </div>
              <div>
                <div className="microlabel">AVG FPS</div>
                <div className="font-mono text-xs text-ink mt-0.5">
                  {device.encoderAvgFps != null ? device.encoderAvgFps.toFixed(1) : "—"}
                </div>
              </div>
              <div>
                <div className="microlabel">AVG LATENCY</div>
                <div className="font-mono text-xs text-ink mt-0.5">
                  {device.encoderAvgLatencyUs != null ? `${(device.encoderAvgLatencyUs / 1000).toFixed(1)} ms` : "—"}
                </div>
              </div>
            </div>
            {sessions === null ? (
              <div className="text-xs text-ink-faint">not reported by this driver</div>
            ) : (
              <Sparkline data={sessionSeries} className="text-accent" height={40} />
            )}
          </div>
        </>
      )}

      {/* f. transcode streams — densest region, and the payoff */}
      <div className="space-y-2">
        <div className="microlabel">TRANSCODE STREAMS</div>

        {tx === undefined && <div className="panel p-4 text-xs text-ink-faint">reading transcode sessions…</div>}

        {tx &&
          !tx.ok &&
          (() => {
            const copy = transcodeUnavailableCopy(tx.reason);
            return (
              <div className="panel p-4 space-y-2">
                <div className="text-sm text-warn font-medium">{copy.headline}</div>
                {copy.fix && <div className="text-xs text-ink-dim">{copy.fix}</div>}
                <div className="font-mono text-xs text-ink-dim">{tx.detail}</div>
              </div>
            );
          })()}

        {tx && tx.ok && tx.streams.length === 0 && (
          <div className="panel p-6 text-center text-ink-faint text-sm">no active playback</div>
        )}

        {tx && tx.ok && tx.streams.length > 0 && (
          <>
            <div className="panel overflow-x-auto hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    {["Title", "User · Client", "Codec", "Resolution", "Bitrate", "Accel"].map((h) => (
                      <th key={h} className="microlabel text-left px-3 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tx.streams.map((s) => {
                    const badge = streamBadge(s);
                    return (
                      <tr key={s.id} className="border-b border-line/50 last:border-0 hover:bg-panel-2/60">
                        <td className="px-3 py-2 max-w-64">
                          <div className="truncate text-ink font-medium" title={s.title}>
                            {s.title}
                          </div>
                          {s.reasons.length > 0 && (
                            <div className="text-[0.68rem] text-ink-faint truncate">{s.reasons.join(", ")}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-dim">
                          {[s.user, s.client].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-ink-dim">{codecPath(s)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-ink-dim">
                          {s.width && s.height ? `${s.width}×${s.height}` : "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-ink-dim">
                          {formatBitrate(s.bitrate)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn("font-mono text-xs font-semibold", badge.className)} title={badge.title}>
                            {badge.text}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-2">
              {tx.streams.map((s) => {
                const badge = streamBadge(s);
                return (
                  <div key={s.id} className="panel p-3 space-y-1.5 min-h-11">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-medium truncate min-w-0" title={s.title}>
                        {s.title}
                      </span>
                      <span
                        className={cn("font-mono text-xs font-semibold shrink-0", badge.className)}
                        title={badge.title}
                      >
                        {badge.text}
                      </span>
                    </div>
                    <div className="text-xs text-ink-dim">{[s.user, s.client].filter(Boolean).join(" · ") || "—"}</div>
                    <div className="font-mono text-xs text-ink-dim">
                      {codecPath(s)} · {s.width && s.height ? `${s.width}×${s.height}` : "—"}
                    </div>
                    <div className="font-mono text-xs text-ink-dim">{formatBitrate(s.bitrate)}</div>
                    {s.reasons.length > 0 && (
                      <div className="text-[0.68rem] text-ink-faint">{s.reasons.join(", ")}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

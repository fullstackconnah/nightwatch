import { allContainerStats, type ContainerStatsRow } from "@/lib/docker";
import { getGpuSnapshot } from "@/lib/gpu";
import { getHostDiskIoCounters, getHostNetCounters, getHostVitals } from "@/lib/host-metrics";
import { getInterfaceCounters } from "@/lib/network";
import { recordMetricsHistoryTick } from "@/lib/metrics-history";
import { RING_CAPACITY, type TelemetryHost, type TelemetryRow, type TelemetrySample } from "./telemetry-types";

/**
 * 1Hz container telemetry: a single shared, refcounted collector feeds any number of
 * SSE subscribers so N browser tabs don't each spin up their own Docker polling loop.
 * State lives on globalThis (mirrors docker.ts's globalForDocker pattern) so Next dev
 * HMR reloads of this module reuse the running loop instead of leaking a second one.
 */

export { RING_CAPACITY };
export type { TelemetryRow, TelemetrySample };

const TARGET_MS = 1000;

type Subscriber = (sample: TelemetrySample) => void;

const globalForTelemetry = globalThis as unknown as {
  __telemetryRing?: TelemetrySample[];
  __telemetrySubscribers?: Set<Subscriber>;
  __telemetryPrevious?: Record<string, ContainerStatsRow>;
  __telemetryPrevTs?: number; // performance.now() of the previous tick
  __telemetryRunning?: boolean;
  __telemetryPrevDiskRead?: number; // cumulative bytes-read sum, previous tick
  __telemetryPrevDiskWrite?: number; // cumulative bytes-written sum, previous tick
  __telemetryPrevNetRx?: number; // cumulative rx bytes, previous tick
  __telemetryPrevNetTx?: number; // cumulative tx bytes, previous tick
  __telemetryPrevIfaces?: Record<string, { rxBytes: number; txBytes: number }>;
};

function ring(): TelemetrySample[] {
  if (!globalForTelemetry.__telemetryRing) globalForTelemetry.__telemetryRing = [];
  return globalForTelemetry.__telemetryRing;
}

function subscribers(): Set<Subscriber> {
  if (!globalForTelemetry.__telemetrySubscribers) globalForTelemetry.__telemetrySubscribers = new Set();
  return globalForTelemetry.__telemetrySubscribers;
}

/** Plain timer sleep. Teardown may lag by up to one tick — much cheaper than the
 * abort/restart races an AbortController introduces here. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** delta/elapsed, guarding every trap: no previous sample, zero/negative elapsed, counter reset, non-finite. */
function rate(curr: number, prev: number | undefined, elapsedSeconds: number): number {
  if (prev === undefined || elapsedSeconds <= 0) return 0;
  const delta = curr - prev;
  if (delta < 0) return 0; // container restarted — cumulative counter reset to zero
  const r = delta / elapsedSeconds;
  return Number.isFinite(r) ? r : 0;
}

async function tick(): Promise<void> {
  // force=true: the 5s allContainerStats cache would otherwise return an identical
  // sample ~4 ticks out of 5 and every rate would compute as 0.
  // Host vitals are fetched alongside, but non-fatally: a host-side failure (e.g. the
  // /host/proc bind mount hiccups) must never cost the tick its container data.
  const [raw, hostVitals, diskCounters, netCounters, gpu] = await Promise.all([
    allContainerStats(true),
    getHostVitals().catch((err: unknown) => {
      console.error("[telemetry] getHostVitals failed:", err);
      return null;
    }),
    getHostDiskIoCounters().catch((err: unknown) => {
      console.error("[telemetry] getHostDiskIoCounters failed:", err);
      return null;
    }),
    getHostNetCounters().catch((err: unknown) => {
      console.error("[telemetry] getHostNetCounters failed:", err);
      return null;
    }),
    getGpuSnapshot().catch((err: unknown) => {
      console.error("[telemetry] getGpuSnapshot failed:", err);
      return null;
    }),
  ]);
  const prev = globalForTelemetry.__telemetryPrevious ?? {};
  const prevTs = globalForTelemetry.__telemetryPrevTs;
  const now = performance.now();
  const elapsedSeconds = prevTs !== undefined ? (now - prevTs) / 1000 : 0;

  const containers: Record<string, TelemetryRow> = {};
  for (const [id, curr] of Object.entries(raw)) {
    const p = prev[id];
    containers[id] = {
      cpuPct: curr.cpuPct,
      memBytes: curr.memBytes,
      memLimit: curr.memLimit,
      rxRate: rate(curr.rxBytes, p?.rxBytes, elapsedSeconds),
      txRate: rate(curr.txBytes, p?.txBytes, elapsedSeconds),
      blkReadRate: rate(curr.blkReadBytes, p?.blkReadBytes, elapsedSeconds),
      blkWriteRate: rate(curr.blkWriteBytes, p?.blkWriteBytes, elapsedSeconds),
      pids: curr.pids,
    };
  }

  // Replacing (not merging into) __telemetryPrevious prunes containers that vanished
  // since the last tick, so the map can't grow unboundedly over a long-lived process.
  globalForTelemetry.__telemetryPrevious = raw;
  globalForTelemetry.__telemetryPrevTs = now;

  let host: TelemetryHost | undefined;
  if (hostVitals) {
    // Disk counters are cumulative since boot; sum across devices and derive a rate
    // against the previous tick's sums via the same guarded rate() helper the
    // container counters use (counter reset, non-positive elapsed, non-finite).
    let diskReadRate: number | null = null;
    let diskWriteRate: number | null = null;
    if (diskCounters) {
      const readSum = diskCounters.reduce((a, d) => a + d.readBytes, 0);
      const writeSum = diskCounters.reduce((a, d) => a + d.writeBytes, 0);
      // rate() returns 0 when there's no previous sum (first tick) or elapsedSeconds
      // <= 0 — exactly the "0, not null" behavior required for a fresh start.
      diskReadRate = rate(readSum, globalForTelemetry.__telemetryPrevDiskRead, elapsedSeconds);
      diskWriteRate = rate(writeSum, globalForTelemetry.__telemetryPrevDiskWrite, elapsedSeconds);
      globalForTelemetry.__telemetryPrevDiskRead = readSum;
      globalForTelemetry.__telemetryPrevDiskWrite = writeSum;
    } else {
      // Unavailable rather than transiently missing — null means "not measured", and
      // dropping the previous sums means a later recovery starts clean instead of
      // deriving a rate across an unknown-length gap.
      globalForTelemetry.__telemetryPrevDiskRead = undefined;
      globalForTelemetry.__telemetryPrevDiskWrite = undefined;
    }

    // Net counters are cumulative since boot; derive rates against the previous
    // tick's values with the same rate() helper — NOT hostVitals.network.rxPerSec.
    // getHostVitals() derives that field from its own module-level lastNet state,
    // which every caller (this 1Hz loop, useResources at 10s, useHost at 5s) diffs
    // against and mutates independently. Calls landing milliseconds apart make dt
    // tiny and the rate becomes quantisation noise (a dip, or a spike if a packet
    // burst falls in that window) — and the UI's 60s peak-as-bar-denominator would
    // let one spurious spike flatten the bar for a full minute. Owning our own
    // cumulative counters and previous-tick state avoids sharing that mutable state.
    let rxRate = 0;
    let txRate = 0;
    if (netCounters) {
      rxRate = rate(netCounters.rxBytes, globalForTelemetry.__telemetryPrevNetRx, elapsedSeconds);
      txRate = rate(netCounters.txBytes, globalForTelemetry.__telemetryPrevNetTx, elapsedSeconds);
      globalForTelemetry.__telemetryPrevNetRx = netCounters.rxBytes;
      globalForTelemetry.__telemetryPrevNetTx = netCounters.txBytes;
    } else {
      // Unlike disk, "no net counters" isn't a state the UI needs to show explicitly
      // (TelemetryHost types rxRate/txRate as plain number) — 0 and carry on, but
      // still drop stale previous state so a later recovery doesn't diff across a gap.
      globalForTelemetry.__telemetryPrevNetRx = undefined;
      globalForTelemetry.__telemetryPrevNetTx = undefined;
    }

    host = {
      // Share of the WHOLE box (0-100), not Docker-style 0-(100*cores) — do not
      // multiply by cores here, the UI needs this as a direct 0-100 bar value.
      cpuPct: hostVitals.cpu.percent,
      cores: hostVitals.cpu.cores,
      memUsed: hostVitals.memory.used,
      memTotal: hostVitals.memory.total,
      memAvailable: hostVitals.memory.available,
      loadAvg: hostVitals.cpu.loadAvg,
      tempC: hostVitals.tempC,
      rxRate,
      txRate,
      diskReadRate,
      diskWriteRate,
    };
  }

  // Per-interface counters do not depend on getHostVitals succeeding, so this
  // sits outside the `if (hostVitals)` block above — a host-vitals hiccup
  // must not cost the tick its interface rates, same reasoning as running
  // diskCounters/netCounters alongside hostVitals rather than inside it.
  // getInterfaceCounters() is synchronous and does its own guarding
  // internally (returns null rather than throwing), but it's still wrapped
  // here so a surprise throw can't take the whole tick down.
  let interfaces: Record<string, { rxRate: number; txRate: number }> | undefined;
  let ifaceCounters: Record<string, { rxBytes: number; txBytes: number }> | null;
  try {
    ifaceCounters = getInterfaceCounters();
  } catch (err) {
    console.error("[telemetry] getInterfaceCounters failed:", err);
    ifaceCounters = null;
  }
  if (ifaceCounters) {
    const prevIfaces = globalForTelemetry.__telemetryPrevIfaces ?? {};
    const out: Record<string, { rxRate: number; txRate: number }> = {};
    for (const [name, curr] of Object.entries(ifaceCounters)) {
      const p = prevIfaces[name];
      out[name] = {
        rxRate: rate(curr.rxBytes, p?.rxBytes, elapsedSeconds),
        txRate: rate(curr.txBytes, p?.txBytes, elapsedSeconds),
      };
    }
    interfaces = out;
    // Replace (not merge into) the previous-tick map so vanished veths are
    // pruned — mirrors __telemetryPrevious's comment and behaviour above.
    globalForTelemetry.__telemetryPrevIfaces = ifaceCounters;
  } else {
    // Unavailable rather than transiently missing — undefined means "not
    // measured this tick", and dropping the previous counters means a later
    // recovery starts clean instead of deriving a rate across an
    // unknown-length gap (same reasoning as the disk/net counters above).
    interfaces = undefined;
    globalForTelemetry.__telemetryPrevIfaces = undefined;
  }

  // A caught null (collector threw) becomes undefined, never a null in the `gpu`
  // field - the type is GpuSnapshot | undefined, and null is not GpuSnapshot.
  const sample: TelemetrySample = { ts: Date.now(), containers, host, gpu: gpu ?? undefined, interfaces };

  // Long-range history sampler, piggybacked on this same 1Hz loop rather than its
  // own timer. Throttles itself to one write per ~30s and never throws — see
  // metrics-history.ts's own docs for why this can never cost the ring a tick.
  try {
    recordMetricsHistoryTick({
      ts: sample.ts,
      host: hostVitals
        ? { cpuPct: hostVitals.cpu.percent, memUsed: hostVitals.memory.used, memTotal: hostVitals.memory.total }
        : null,
      mounts: hostVitals?.disk ?? null,
      containers,
    });
  } catch (err) {
    console.error("[telemetry] recordMetricsHistoryTick threw:", err);
  }

  const r = ring();
  r.push(sample);
  if (r.length > RING_CAPACITY) r.splice(0, r.length - RING_CAPACITY);

  for (const cb of subscribers()) {
    try {
      cb(sample);
    } catch (err) {
      // One wedged subscriber (an SSE controller closed underneath us) must not stop
      // delivery to every other connected client.
      console.error("[telemetry] subscriber threw:", err);
    }
  }
}

async function loop(): Promise<void> {
  try {
    // Subscriber count is the sole "should I still be running" signal. A subscriber
    // arriving during the final sleep keeps the loop alive, so a brief navigation
    // doesn't discard the warm ring.
    while (subscribers().size > 0) {
      const start = performance.now();
      try {
        await tick();
      } catch (err) {
        // One failed tick (daemon hiccup, proxy restart) must never kill the loop.
        console.error("[telemetry] tick failed:", err);
      }
      await sleep(Math.max(0, TARGET_MS - (performance.now() - start)));
    }
  } finally {
    // A stopped loop leaves poisoned state: prevTs/previous would make the first tick
    // after a restart emit a rate averaged over the whole idle gap, and the ring would
    // hand a new tab a "60 second" history with a multi-minute hole in it.
    globalForTelemetry.__telemetryRunning = false;
    globalForTelemetry.__telemetryPrevious = undefined;
    globalForTelemetry.__telemetryPrevTs = undefined;
    globalForTelemetry.__telemetryPrevDiskRead = undefined;
    globalForTelemetry.__telemetryPrevDiskWrite = undefined;
    globalForTelemetry.__telemetryPrevNetRx = undefined;
    globalForTelemetry.__telemetryPrevNetTx = undefined;
    globalForTelemetry.__telemetryPrevIfaces = undefined;
    globalForTelemetry.__telemetryRing = [];
  }
}

/**
 * Subscribe to the shared 1Hz telemetry stream. Starts the collector loop on the first
 * subscriber; the loop tears itself down once the last one unsubscribes.
 */
export function subscribeTelemetry(cb: Subscriber): () => void {
  const subs = subscribers();
  subs.add(cb);
  if (!globalForTelemetry.__telemetryRunning) {
    globalForTelemetry.__telemetryRunning = true;
    void loop();
  }

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    subs.delete(cb);
    // The loop notices the empty set on its next iteration and tears itself down.
  };
}

/** Copy of the current ring, oldest first — used to warm-start new SSE subscribers. */
export function getTelemetryHistory(): TelemetrySample[] {
  return [...ring()];
}

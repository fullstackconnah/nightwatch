import { allContainerStats, listContainersWithRuntime, TELEMETRY_CALL_MS, type ContainerStatsRow } from "@/lib/docker";
import { recordChangeLogTick } from "@/lib/change-log-store";
import { shouldSkipTick } from "@/lib/metrics-history-math";
import { getGpuSnapshot } from "@/lib/gpu";
import { getHostDiskIoCounters, getHostNetCounters, getHostVitals } from "@/lib/host-metrics";
import { getInterfaceCounters } from "@/lib/network";
import { recordMetricsHistoryTick, SAMPLE_INTERVAL_MS } from "@/lib/metrics-history";
import { loopStep, nextDelayMs } from "@/lib/telemetry-loop";
import { withTimeout } from "@/lib/single-flight";
import { recovered, throttledError } from "@/lib/log-throttle";
import { RING_CAPACITY, type TelemetryHost, type TelemetryRow, type TelemetrySample } from "@/lib/types/telemetry";

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
  __telemetryPrevReadAt?: number; // performance.now() when the previous tick started reading host counters
  __telemetryRunning?: boolean;
  __telemetryWake?: () => void; // cuts the current sleep short (idle sleep is 30 s)
  __telemetryPrevDiskRead?: number; // cumulative bytes-read sum, previous tick
  __telemetryPrevDiskWrite?: number; // cumulative bytes-written sum, previous tick
  __telemetryPrevNetRx?: number; // cumulative rx bytes, previous tick
  __telemetryPrevNetTx?: number; // cumulative tx bytes, previous tick
  __telemetryPrevIfaces?: Record<string, { rxBytes: number; txBytes: number }>;
  __telemetryChangeLogTs?: number; // ts of the last change-log tick
};

function ring(): TelemetrySample[] {
  if (!globalForTelemetry.__telemetryRing) globalForTelemetry.__telemetryRing = [];
  return globalForTelemetry.__telemetryRing;
}

function subscribers(): Set<Subscriber> {
  if (!globalForTelemetry.__telemetrySubscribers) globalForTelemetry.__telemetrySubscribers = new Set();
  return globalForTelemetry.__telemetrySubscribers;
}

/** Plain timer sleep. Wakeable via __telemetryWake — much cheaper than the
 * abort/restart races an AbortController introduces here. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      globalForTelemetry.__telemetryWake = undefined;
      resolve();
    }
    // Only the idle sleep is wakeable: cutting a live 1 s sleep short would emit a rate over a few ms.
    if (ms > TARGET_MS) globalForTelemetry.__telemetryWake = done;
  });
}

function wakeLoop(): void {
  globalForTelemetry.__telemetryWake?.();
}

/** Single start point for the loop (boot and first subscriber), guarded by __telemetryRunning. */
function ensureLoop(): void {
  if (!globalForTelemetry.__telemetryRunning) {
    globalForTelemetry.__telemetryRunning = true;
    void loop();
  }
}

/** Boot hook (instrumentation.ts): keeps the history sampler running with no page open. */
export function startTelemetryRecorder(): void {
  ensureLoop();
}

/** delta/elapsed, guarding every trap: no previous sample, zero/negative elapsed, counter reset, non-finite. */
function rate(curr: number, prev: number | undefined, elapsedSeconds: number): number {
  if (prev === undefined || elapsedSeconds <= 0) return 0;
  const delta = curr - prev;
  if (delta < 0) return 0; // container restarted — cumulative counter reset to zero
  const r = delta / elapsedSeconds;
  return Number.isFinite(r) ? r : 0;
}

async function tick(feedRing: boolean): Promise<void> {
  // force=true: the 5s allContainerStats cache would otherwise return an identical
  // sample ~4 ticks out of 5 and every rate would compute as 0.
  // Host vitals are fetched alongside, but non-fatally: a host-side failure (e.g. the
  // /host/proc bind mount hiccups) must never cost the tick its container data.
  // Host counters are read as Promise.all starts; allContainerStats(true) samples later,
  // so host rates use this read time and container rates keep the end-of-tick time.
  const readAt = performance.now();
  const [raw, hostVitals, diskCounters, netCounters, gpu] = await Promise.all([
    allContainerStats(true),
    withTimeout(getHostVitals(), TELEMETRY_CALL_MS, () => null)
      .then((v) => {
        if (v !== null) recovered("getHostVitals"); // null is the timeout fallback, not a success
        return v;
      })
      .catch((err: unknown) => {
        throttledError("getHostVitals", err);
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
    withTimeout(getGpuSnapshot(), TELEMETRY_CALL_MS, () => null)
      .then((v) => {
        if (v !== null) recovered("getGpuSnapshot");
        return v;
      })
      .catch((err: unknown) => {
        throttledError("getGpuSnapshot", err);
        return null;
      }),
  ]);
  const prev = globalForTelemetry.__telemetryPrevious ?? {};
  const prevTs = globalForTelemetry.__telemetryPrevTs;
  const now = performance.now();
  const elapsedSeconds = prevTs !== undefined ? (now - prevTs) / 1000 : 0;
  const prevReadAt = globalForTelemetry.__telemetryPrevReadAt;
  const hostElapsedSeconds = prevReadAt !== undefined ? (readAt - prevReadAt) / 1000 : 0;

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
  globalForTelemetry.__telemetryPrevReadAt = readAt;

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
      diskReadRate = rate(readSum, globalForTelemetry.__telemetryPrevDiskRead, hostElapsedSeconds);
      diskWriteRate = rate(writeSum, globalForTelemetry.__telemetryPrevDiskWrite, hostElapsedSeconds);
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
      rxRate = rate(netCounters.rxBytes, globalForTelemetry.__telemetryPrevNetRx, hostElapsedSeconds);
      txRate = rate(netCounters.txBytes, globalForTelemetry.__telemetryPrevNetTx, hostElapsedSeconds);
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
    recovered("getInterfaceCounters");
  } catch (err) {
    throttledError("getInterfaceCounters", err);
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
    recovered("recordMetricsHistoryTick");
  } catch (err) {
    throttledError("recordMetricsHistoryTick", err);
  }

  // Container change log: one list and its inspects every ~30s, stored so Home can count restarts.
  // Never awaited and never throws (the store catches everything), so it cannot cost the ring a tick.
  try {
    if (!shouldSkipTick(sample.ts, globalForTelemetry.__telemetryChangeLogTs ?? 0, SAMPLE_INTERVAL_MS)) {
      globalForTelemetry.__telemetryChangeLogTs = sample.ts;
      void recordChangeLogTick(sample.ts, listContainersWithRuntime);
    }
    recovered("recordChangeLogTick");
  } catch (err) {
    throttledError("recordChangeLogTick", err);
  }

  if (!feedRing) return; // idle tick: history only, no ring, no subscribers
  const r = ring();
  r.push(sample);
  if (r.length > RING_CAPACITY) r.splice(0, r.length - RING_CAPACITY);

  for (const cb of subscribers()) {
    try {
      cb(sample);
    } catch (err) {
      // One wedged subscriber (an SSE controller closed underneath us) must not stop
      // delivery to every other connected client.
      // No recovered() here: the key is shared by every subscriber, so one success proves nothing.
      throttledError("subscriber", err);
    }
  }
}

/** Drop every previous-tick counter so the next tick is a cold start (rates 0, never averaged over a gap). */
function resetRateState(): void {
  globalForTelemetry.__telemetryPrevious = undefined;
  globalForTelemetry.__telemetryPrevTs = undefined;
  globalForTelemetry.__telemetryPrevReadAt = undefined;
  globalForTelemetry.__telemetryPrevDiskRead = undefined;
  globalForTelemetry.__telemetryPrevDiskWrite = undefined;
  globalForTelemetry.__telemetryPrevNetRx = undefined;
  globalForTelemetry.__telemetryPrevNetTx = undefined;
  globalForTelemetry.__telemetryPrevIfaces = undefined;
}

/**
 * Runs for the life of the server (started at boot, or by the first subscriber in dev/tests).
 * With subscribers it ticks at TARGET_MS and feeds the ring; with none it ticks at the
 * history cadence so metrics history records with no page open. See telemetry-loop.ts.
 */
async function loop(): Promise<void> {
  let wasLive = false;
  try {
    for (;;) {
      const step = loopStep({ subscribers: subscribers().size, wasLive });
      if (step.resetRates) resetRateState();
      if (step.clearRing) globalForTelemetry.__telemetryRing = [];
      wasLive = step.feedRing;
      const start = performance.now();
      try {
        await tick(step.feedRing);
        recovered("tick");
      } catch (err) {
        // One failed tick (daemon hiccup, proxy restart) must never kill the loop.
        throttledError("tick", err);
      }
      await sleep(
        nextDelayMs({
          subscribers: subscribers().size,
          elapsedMs: performance.now() - start,
          liveMs: TARGET_MS,
          idleMs: SAMPLE_INTERVAL_MS,
        }),
      );
    }
  } finally {
    // Only reached if the loop really exits (unexpected throw): leave no poisoned state for a restart.
    globalForTelemetry.__telemetryRunning = false;
    resetRateState();
    globalForTelemetry.__telemetryRing = [];
  }
}

/**
 * Subscribe to the shared 1Hz telemetry stream. Starts the collector loop if it is not
 * already running (it normally runs since boot) and wakes it out of its idle sleep.
 */
export function subscribeTelemetry(cb: Subscriber): () => void {
  const subs = subscribers();
  subs.add(cb);
  ensureLoop();
  wakeLoop();

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    subs.delete(cb);
    // The loop notices the empty set on its next iteration and drops to the idle cadence.
  };
}

/** Copy of the current ring, oldest first — used to warm-start new SSE subscribers. */
export function getTelemetryHistory(): TelemetrySample[] {
  return [...ring()];
}

import { allContainerStats, type ContainerStatsRow } from "@/lib/docker";
import { RING_CAPACITY, type TelemetryRow, type TelemetrySample } from "./telemetry-types";

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
  const raw = await allContainerStats(true);
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

  const sample: TelemetrySample = { ts: Date.now(), containers };
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

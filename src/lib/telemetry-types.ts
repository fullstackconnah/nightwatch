/** Wire contract shared by the SSE producer (src/lib/telemetry.ts) and the browser
 * consumer (src/lib/client.ts). Deliberately import-free: client.ts is "use client",
 * so anything reachable from here lands in the browser bundle — and telemetry.ts
 * reaches dockerode. */
export interface TelemetryRow {
  cpuPct: number;
  memBytes: number;
  memLimit: number;
  rxRate: number; // bytes/sec, derived
  txRate: number; // bytes/sec, derived
  blkReadRate: number; // bytes/sec, derived
  blkWriteRate: number; // bytes/sec, derived
  pids: number;
}
export interface TelemetrySample {
  ts: number; // Date.now() at emit
  containers: Record<string, TelemetryRow>;
}
export const RING_CAPACITY = 60;

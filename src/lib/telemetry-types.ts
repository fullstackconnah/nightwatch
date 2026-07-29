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
/** Host-wide vitals sampled at the same 1Hz cadence as the container rows, so the
 * UI can show "what is the whole box doing" alongside the per-container treemap. */
export interface TelemetryHost {
  cpuPct: number; // 0-100, share of the WHOLE box (not Docker-style 0-(100*cores))
  cores: number;
  memUsed: number;
  memTotal: number;
  memAvailable: number;
  loadAvg: number[]; // [1m, 5m, 15m]
  tempC: number | null;
  rxRate: number; // bytes/sec, host-wide
  txRate: number; // bytes/sec, host-wide
  diskReadRate: number | null; // bytes/sec; null = /proc/diskstats unavailable, NOT zero
  diskWriteRate: number | null;
}
export interface TelemetrySample {
  ts: number; // Date.now() at emit
  containers: Record<string, TelemetryRow>;
  // Optional: a tick where getHostVitals() fails must still deliver container data.
  host?: TelemetryHost;
}
export const RING_CAPACITY = 60;

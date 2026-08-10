/**
 * GPU telemetry shapes. Import-free leaf on purpose: `src/lib/client.ts` is a
 * "use client" module, so anything it value-imports gets pulled into the browser
 * bundle. Keeping these types in a module with zero imports is what stops
 * nvidia-smi/child_process/dockerode from following them across the boundary.
 * (tsc cannot catch that class of mistake — only `next build` fails.)
 */

/**
 * Why GPU telemetry is missing. Each value maps to a DIFFERENT fix, and the UI
 * states the fix verbatim — "unavailable" alone would strand the reader.
 */
export type GpuUnavailableReason =
  /** nvidia-smi is not in this container: the nvidia runtime block is not enabled. */
  | "no-binary"
  /** NVML refused to init: loaded kernel module != userspace libs. Host reboot. */
  | "driver-mismatch"
  /** nvidia-smi ran and reported no GPU at all. */
  | "no-device"
  /** Timed out, unparseable output, or any other failure; `detail` carries it. */
  | "error";

export interface GpuUnavailable {
  ok: false;
  reason: GpuUnavailableReason;
  /** First meaningful line of stderr, trimmed. Shown to the reader verbatim. */
  detail: string;
}

/** One process holding VRAM, attributed back to its container where possible. */
export interface GpuProcess {
  pid: number;
  /** process_name as nvidia-smi reports it, e.g. "/usr/lib/jellyfin-ffmpeg/ffmpeg". */
  name: string;
  memBytes: number;
  /** Full 64-char id from /host/proc/<pid>/cgroup, or null for a host process. */
  containerId: string | null;
  /** Resolved container name, or null when unresolved (host process, or gone). */
  containerName: string | null;
}

export interface GpuDevice {
  index: number;
  name: string;
  uuid: string;
  /** Core/SM utilization, 0-100. */
  utilizationPct: number;
  /**
   * Memory-CONTROLLER bandwidth utilization, 0-100. This is not VRAM fill —
   * never label it as such; memUsedBytes/memTotalBytes is the fill.
   */
  memUtilizationPct: number;
  memUsedBytes: number;
  memTotalBytes: number;
  tempC: number | null;
  /** Slowdown threshold, the only honest denominator for the thermal gauge. */
  tempMaxC: number | null;
  fanPct: number | null;
  powerWatts: number | null;
  powerLimitWatts: number | null;
  smClockMhz: number | null;
  /** NVENC session count. null when the driver does not expose encoder stats. */
  encoderSessions: number | null;
  encoderAvgFps: number | null;
  encoderAvgLatencyUs: number | null;
  /**
   * Processes NVML could itemize. Their memBytes deliberately does NOT sum to
   * memUsedBytes — driver overhead and graphics contexts are not itemized, so
   * the UI must show the remainder as "unattributed", never fold it into a
   * process or silently rescale.
   */
  processes: GpuProcess[];
}

export interface GpuAvailable {
  ok: true;
  driverVersion: string;
  devices: GpuDevice[];
}

export type GpuSnapshot = GpuAvailable | GpuUnavailable;

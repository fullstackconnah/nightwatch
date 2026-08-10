/**
 * Process telemetry shapes. Import-free leaf on purpose: `src/lib/client.ts` is a
 * "use client" module, so anything it value-imports gets pulled into the browser
 * bundle. Keeping these types in a module with zero imports is what stops
 * node:fs/child_process/dockerode from following them across the boundary.
 * (tsc cannot catch that class of mistake — only `next build` fails.)
 */

/** One row of the host-wide process table. */
export interface ProcessRow {
  pid: number;
  comm: string; // from stat, may contain spaces/parens
  cmdline: string | null; // null for kernel threads (empty cmdline)
  /** Empty cmdline and not a zombie. A zombie also has no cmdline but is an
   *  ordinary userspace process that exited unreaped, so it must not be
   *  presented as a kernel thread. */
  isKernel: boolean;
  state: string; // single char: R S D Z T etc.
  ppid: number;
  threads: number;
  /** One busy core = 100 (Docker-style, matching TelemetryRow.cpuPct).
   *  null = this process was not present in the previous sample, so no
   *  delta exists yet. NOT zero — an unmeasured process is not an idle one. */
  cpuPct: number | null;
  rssBytes: number;
  /** 64-hex docker container id, or null for host/kernel processes. */
  containerId: string | null;
  /** Human container name resolved from the docker API, else null. */
  containerName: string | null;
  /** Live bytes/sec for this process's CONTAINER cgroup (rbytes+wbytes delta).
   *  This is CONTAINER-SCOPED, not per-process: every process in the same
   *  container reports the SAME figure. Per-process disk I/O is unavailable
   *  to an unprivileged reader (/proc/<pid>/io is 0400). null = no container
   *  or no readable io.stat. Never present this as the process's own I/O. */
  cgroupIoRate: number | null;
}

export interface ProcessSnapshot {
  ts: number;
  /** Whole-box context so the UI can show a share-of-total honestly. */
  cores: number;
  memTotal: number;
  processes: ProcessRow[];
  /** Total pids seen, including any dropped for being unreadable. */
  scanned: number;
  /** Pids that vanished or were unreadable mid-scan. */
  skipped: number;
  /** Present only when the scan could not run at all. */
  error?: string;
}

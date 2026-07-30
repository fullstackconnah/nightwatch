import fsp from "node:fs/promises";
import { HOST_PROC, HOST_SYS } from "@/lib/host-metrics";
import { listContainers } from "@/lib/docker";
import type { ProcessRow, ProcessSnapshot } from "@/lib/process-types";

/**
 * Host-wide process table collector. Server-only: node:fs + dockerode must
 * never reach src/lib/client.ts (see the import-free-leaf comment in
 * process-types.ts).
 *
 * Reads through the /host/proc and /host/sys bind mounts as an unprivileged
 * (uid 1000) reader. /proc/<pid>/io is 0400 and unreadable for all but a
 * handful of pids, and delayacct_blkio_ticks (stat field 42) is always 0 on
 * this host (task_delayacct is off) — neither is usable, so per-process disk
 * I/O does not exist here. The only real I/O signal available is the
 * CONTAINER's cgroup io.stat, which is why cgroupIoRate is scoped to the
 * whole container rather than a single pid.
 */

const PAGE_SIZE = 4096;
const CLK_TCK = 100; // sanity check: 100 ticks over 1000ms = 100% of one core
const SAMPLE_DELAY_MS = 250;
const STALE_BASELINE_MS = 30_000;
/** Samples older than this are dropped, so the widest CPU window is ~12s at the
 *  client's 2s poll — long enough to resolve a 0.05% container, short enough that
 *  the figure still tracks what the box is doing now. */
const SAMPLE_MAX_AGE_MS = 12_000;
/** Belt to SAMPLE_MAX_AGE_MS's braces: caps memory if something polls far faster
 *  than every 2s. Each entry holds ~476 small records. */
const MAX_SAMPLES = 10;
const READ_CONCURRENCY = 64; // bound simultaneous file handles across ~476 pids x 3 reads each
const CONTAINER_NAME_TTL_MS = 10_000;

interface StatFields {
  comm: string;
  state: string;
  ppid: number;
  utime: number;
  stime: number;
  threads: number;
  starttime: number;
  rssPages: number;
}

interface PidTick {
  ticks: number; // utime+stime at sample time
  starttime: number; // used to detect pid reuse
}

interface ProcessCacheEntry {
  ts: number;
  ticks: Map<number, PidTick>;
  io: Map<string, number>; // containerId -> cumulative rbytes+wbytes at ts
}

interface ContainerNameCacheEntry {
  ts: number;
  map: Map<string, string>;
}

// Mirrors gpu.ts/docker.ts's globalForX pattern: state on globalThis survives
// Next dev HMR reloads of this module.
const globalForProcesses = globalThis as unknown as {
  /** Recent samples, OLDEST FIRST. See getProcessSnapshot for why a ring rather
   *  than a single previous sample. */
  __processSamples?: ProcessCacheEntry[];
  __processContainerNameCache?: ContainerNameCacheEntry;
  /** undefined = never looked up; null = looked up and we are not in a container. */
  __processOwnContainerId?: string | null;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `fn` over `items` with at most `limit` in flight at once. Without
 * this, scanning ~476 pids x (stat + cmdline + cgroup) would try to open
 * >1400 file handles simultaneously. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// --- /proc/<pid>/stat parsing ------------------------------------------------

/**
 * `comm` can itself contain spaces AND parentheses (e.g. "next-server (v"),
 * so the split must find the LAST ")" in the line, never the first.
 *
 * After that split, the remainder is whitespace-split into a 0-indexed array
 * `f` with 50 entries (52 total stat fields; pid and comm are already
 * consumed by the paren split, and state becomes f[0]). A stat field
 * numbered N per proc(5) then lands at f[N - 3] — e.g. utime is field 14 ->
 * f[11], rss is field 24 -> f[21]. This offset-by-3 rule is the #1 source of
 * bugs in /proc parsers; verified by hand against a real captured dockerd
 * line (comm=dockerd, state=S, ppid=1, utime=82906, threads=68,
 * starttime=1255, rss_pages=46683) before trusting it here.
 */
function parseStatLine(line: string): StatFields | null {
  const trimmed = line.trim();
  const openIdx = trimmed.indexOf("(");
  const closeIdx = trimmed.lastIndexOf(")");
  if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) return null;
  const comm = trimmed.slice(openIdx + 1, closeIdx);
  const rest = trimmed.slice(closeIdx + 2); // skip ") "
  const f = rest.split(/\s+/);
  if (f.length < 22) return null; // need at least through field 24 (rss)

  const state = f[0];
  const ppid = Number(f[1]); // field 4
  const utime = Number(f[11]); // field 14
  const stime = Number(f[12]); // field 15
  const threads = Number(f[17]); // field 20
  const starttime = Number(f[19]); // field 22
  const rssPages = Number(f[21]); // field 24

  if (![ppid, utime, stime, threads, starttime, rssPages].every(Number.isFinite)) return null;

  return { comm, state, ppid, utime, stime, threads, starttime, rssPages };
}

async function readPidDirs(): Promise<number[]> {
  const entries = await fsp.readdir(HOST_PROC);
  return entries.map((e) => Number(e)).filter((n) => Number.isInteger(n) && n > 0);
}

async function readStatOnly(pid: number): Promise<{ pid: number; stat: StatFields } | null> {
  try {
    const content = await fsp.readFile(`${HOST_PROC}/${pid}/stat`, "utf8");
    const stat = parseStatLine(content);
    return stat ? { pid, stat } : null;
  } catch {
    // Process exited mid-scan — normal, not an error.
    return null;
  }
}

/** Lightweight tick-only sample, used to seed a fresh baseline when there is
 * no usable previous sample. Skips cmdline/cgroup reads since this sample is
 * discarded once the real (returned) sample is taken. */
async function sampleTicksOnly(pids: number[]): Promise<Map<number, PidTick>> {
  const rows = await mapWithConcurrency(pids, READ_CONCURRENCY, readStatOnly);
  const ticks = new Map<number, PidTick>();
  for (const row of rows) {
    if (!row) continue;
    ticks.set(row.pid, { ticks: row.stat.utime + row.stat.stime, starttime: row.stat.starttime });
  }
  return ticks;
}

// --- container id extraction -------------------------------------------------

// Matches both cgroup layouts docker can produce for a container's cgroup path
// (same regex as src/lib/gpu.ts's CONTAINER_ID_RE — kept local here per that
// file's own comment, since gpu.ts does not export a reusable helper for it):
//  - cgroup v2, systemd-managed: "0::/system.slice/docker-<64hex>.scope"
//  - cgroupfs (v1, or v2 without systemd): ".../docker/<64hex>[/...]"
const CONTAINER_ID_RE = /docker-([0-9a-f]{64})\.scope|\/docker\/([0-9a-f]{64})(?:[/\n]|$)/;

function extractContainerId(cgroupContent: string): string | null {
  const m = cgroupContent.match(CONTAINER_ID_RE);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

/**
 * A container cannot see its OWN docker id in /proc/<pid>/cgroup. The cgroup
 * namespace renders the container's own scope as the root, so our processes read
 * a bare "0::/" while every other container reads "0::/../docker-<id>.scope".
 *
 * Left unhandled that is not cosmetic: this container's own processes
 * (next-server, node, and the `du` of a disk-usage scan — measured at 25% CPU and
 * 229 MiB together) land in the "other" bucket, and the dashboard's own row
 * disappears from the containers view entirely — 25 rows for a 26-container
 * fleet, with the shortfall silently inflating "other".
 *
 * The id is recoverable from our own mountinfo, because docker bind-mounts
 * /etc/hostname, /etc/hosts and /etc/resolv.conf out of
 * /var/lib/docker/containers/<64hex>/. Verified equal to `docker inspect .Id`.
 * Returns null when not in a container at all (dev server on the host), where
 * leaving "0::/" unattributed is then the correct answer.
 */
const OWN_CONTAINER_ID_RE = /containers\/([0-9a-f]{64})/;

async function getOwnContainerId(): Promise<string | null> {
  if (globalForProcesses.__processOwnContainerId !== undefined) {
    return globalForProcesses.__processOwnContainerId;
  }
  let id: string | null = null;
  try {
    // Deliberately our OWN /proc, not HOST_PROC — this asks "who am I".
    const content = await fsp.readFile("/proc/self/mountinfo", "utf8");
    id = content.match(OWN_CONTAINER_ID_RE)?.[1] ?? null;
  } catch {
    id = null;
  }
  globalForProcesses.__processOwnContainerId = id;
  return id;
}

// --- per-pid cmdline + cgroup read -------------------------------------------

interface PidDetail {
  pid: number;
  stat: StatFields;
  cmdline: string | null;
  isKernel: boolean;
  containerId: string | null;
}

async function readPidDetail(pid: number, ownContainerId: string | null): Promise<PidDetail | null> {
  let stat: StatFields | null;
  try {
    const statContent = await fsp.readFile(`${HOST_PROC}/${pid}/stat`, "utf8");
    stat = parseStatLine(statContent);
  } catch {
    return null; // pid died mid-scan
  }
  if (!stat) return null;

  let cmdline: string | null = null;
  try {
    const raw = await fsp.readFile(`${HOST_PROC}/${pid}/cmdline`, "utf8");
    const cleaned = raw.replace(/\0/g, " ").trim();
    cmdline = cleaned.length > 0 ? cleaned : null;
  } catch {
    cmdline = null; // treat as kernel thread / unreadable, not a scan failure
  }

  let containerId: string | null = null;
  try {
    const cgroupContent = await fsp.readFile(`${HOST_PROC}/${pid}/cgroup`, "utf8");
    containerId = extractContainerId(cgroupContent);
    // See getOwnContainerId. Only OUR processes render as a bare "0::/" — every
    // other container is "0::/../docker-…" and host services are
    // "0::/../docker.service" and the like, so this cannot over-claim.
    if (containerId === null && ownContainerId !== null && cgroupContent.trim() === "0::/") {
      containerId = ownContainerId;
    }
  } catch {
    containerId = null;
  }

  // Kernel threads carry an empty cmdline — but so does a ZOMBIE, which is an
  // ordinary userspace process that has exited and not been reaped. Testing the
  // empty cmdline alone would render those bracketed, claiming they are kernel
  // threads when they are the opposite: a userspace bug worth noticing.
  const isKernel = cmdline === null && stat.state !== "Z";

  return { pid, stat, cmdline, isKernel, containerId };
}

// --- container name resolution -----------------------------------------------

/** Resolves 64-hex container ids to human names via the existing docker
 * listContainers() helper (same one gpu.ts uses), cached for
 * CONTAINER_NAME_TTL_MS so a 2s poll doesn't hammer the docker socket. */
async function resolveContainerNames(containerIds: Set<string>): Promise<Map<string, string>> {
  if (containerIds.size === 0) return new Map();

  const cached = globalForProcesses.__processContainerNameCache;
  const now = Date.now();
  if (cached && now - cached.ts < CONTAINER_NAME_TTL_MS) return cached.map;

  let containers: Awaited<ReturnType<typeof listContainers>>;
  try {
    containers = await listContainers();
  } catch {
    return cached?.map ?? new Map();
  }

  const map = new Map<string, string>();
  for (const id of containerIds) {
    const match = containers.find((c) => c.id === id || c.id.startsWith(id));
    if (match) map.set(id, match.name);
  }
  globalForProcesses.__processContainerNameCache = { ts: now, map };
  return map;
}

// --- cgroup io.stat -----------------------------------------------------------

/** Sums rbytes=/wbytes= across every device line in a cgroup io.stat file. */
function parseIoStatTotal(content: string): number {
  let total = 0;
  for (const line of content.split("\n")) {
    const rMatch = line.match(/rbytes=(\d+)/);
    const wMatch = line.match(/wbytes=(\d+)/);
    if (rMatch) total += Number(rMatch[1]);
    if (wMatch) total += Number(wMatch[1]);
  }
  return total;
}

async function readContainerIoTotal(containerId: string): Promise<number | null> {
  try {
    const content = await fsp.readFile(
      `${HOST_SYS}/fs/cgroup/system.slice/docker-${containerId}.scope/io.stat`,
      "utf8",
    );
    return parseIoStatTotal(content);
  } catch {
    return null;
  }
}

// --- main ---------------------------------------------------------------------

/** One full scan: stat+cmdline+cgroup for every readable pid, container name
 * resolution, and cgroup io.stat totals. Does not compute rates — the caller
 * diffs against the previous cached sample for that. */
async function scanOnce(pids: number[]): Promise<{
  details: PidDetail[];
  scanned: number;
  skipped: number;
  ioTotals: Map<string, number>;
}> {
  const ownContainerId = await getOwnContainerId();
  const rows = await mapWithConcurrency(pids, READ_CONCURRENCY, (pid) => readPidDetail(pid, ownContainerId));
  const details: PidDetail[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (row) details.push(row);
    else skipped++;
  }

  const containerIds = new Set(details.map((d) => d.containerId).filter((id): id is string => id !== null));
  const ioResults = await mapWithConcurrency(
    [...containerIds],
    READ_CONCURRENCY,
    async (id) => [id, await readContainerIoTotal(id)] as const,
  );
  const ioTotals = new Map<string, number>();
  for (const [id, total] of ioResults) {
    if (total !== null) ioTotals.set(id, total);
  }

  return { details, scanned: pids.length, skipped, ioTotals };
}

export async function getProcessSnapshot(): Promise<ProcessSnapshot> {
  let cores = 0;
  let memTotal = 0;
  try {
    const os = await import("node:os");
    cores = os.cpus().length;
    memTotal = os.totalmem();
  } catch {
    // Leave at 0 — never let a host-info lookup fail the whole scan.
  }

  let pids: number[];
  try {
    pids = await readPidDirs();
  } catch (err) {
    return {
      ts: Date.now(),
      cores,
      memTotal,
      processes: [],
      scanned: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : "process scan failed",
    };
  }

  const now0 = Date.now();

  /**
   * A ring of recent samples, not just the previous one.
   *
   * CPU here comes from jiffies, and CLK_TCK is 100, so one tick is 10ms. Diffed
   * over a single 2s poll that is a resolution of ~0.5 percentage points, which
   * floors every container busier than nothing but quieter than ~0.2% to a flat
   * 0.0% — measured: 20 of this box's 26 containers, while `docker stats` (which
   * reads cgroup CPU in nanoseconds) had them at 0.02-0.32%. A table that reports
   * 0.0% for two thirds of its rows reads as broken even when each figure is
   * technically what was measured.
   *
   * Diffing instead against the OLDEST retained sample that saw the same process
   * widens the window ~5x and improves the resolution with it, and a ~10s average
   * is a better answer to "which container is busy" than a 2s snapshot anyway.
   * Per-process rather than one shared baseline, so a process that started three
   * seconds ago still gets a figure from the newest sample that has it.
   */
  const samples = (globalForProcesses.__processSamples ?? []).filter((s) => now0 - s.ts <= SAMPLE_MAX_AGE_MS);
  const newest = samples.at(-1);

  if (!newest || now0 - newest.ts >= STALE_BASELINE_MS) {
    // Cold start, or every retained sample has gone stale — take an internal
    // throwaway sample and wait, so the response we actually RETURN already
    // carries a real CPU delta instead of a screen of dashes.
    const ticks = await sampleTicksOnly(pids);
    // Stamp it AFTER those reads finish, not from the earlier `now0`:
    // sampleTicksOnly spends tens of ms crossing ~476 pids, and timing the
    // interval from before them would inflate the delta and understate every
    // CPU figure in the first response the reader ever sees.
    samples.length = 0;
    samples.push({ ts: Date.now(), ticks, io: new Map() });
    await delay(SAMPLE_DELAY_MS);
  }

  /** Widest usable window for this pid: the oldest retained sample that saw the
   *  same process. starttime guards pid reuse — a pid recycled onto a different
   *  process would otherwise show its tick counter leaping from 0 to a large
   *  value, a wild bogus spike instead of the correct "no baseline yet" null. */
  function tickBaseline(pid: number, starttime: number): { ts: number; ticks: number } | null {
    for (const s of samples) {
      const t = s.ticks.get(pid);
      if (t && t.starttime === starttime) return { ts: s.ts, ticks: t.ticks };
    }
    return null;
  }

  /** Same widest-window rule for a container's cumulative io.stat total. */
  function ioBaseline(id: string): { ts: number; total: number } | null {
    for (const s of samples) {
      const v = s.io.get(id);
      if (v !== undefined) return { ts: s.ts, total: v };
    }
    return null;
  }

  const { details, scanned, skipped, ioTotals } = await scanOnce(pids);
  const sampleTs = Date.now();

  const containerIds = new Set(details.map((d) => d.containerId).filter((id): id is string => id !== null));
  const nameMap = await resolveContainerNames(containerIds);

  // cgroup io rate: diff this scan's per-container cumulative total against the
  // oldest retained total for that container. Missing on either side, a
  // non-positive interval, or a negative delta (cgroup recreated, e.g. the
  // container restarted) => null, never a fabricated rate.
  const ioRateByContainer = new Map<string, number | null>();
  for (const id of containerIds) {
    const nowTotal = ioTotals.get(id);
    const base = ioBaseline(id);
    if (nowTotal === undefined || base === null) {
      ioRateByContainer.set(id, null);
      continue;
    }
    const span = sampleTs - base.ts;
    const delta = nowTotal - base.total;
    ioRateByContainer.set(id, span > 0 && delta >= 0 ? (delta * 1000) / span : null);
  }

  const processes: ProcessRow[] = details.map((d) => {
    const base = tickBaseline(d.pid, d.stat.starttime);
    let cpuPct: number | null = null;
    if (base) {
      const span = sampleTs - base.ts;
      const deltaTicks = d.stat.utime + d.stat.stime - base.ticks;
      if (span > 0 && deltaTicks >= 0) {
        // One busy core = 100 (Docker-style, matching TelemetryRow.cpuPct).
        // Sanity check: CLK_TCK=100 means 1 tick = 10ms, so 100 ticks spent
        // over a 1000ms window is a fully-busy core -> 100.
        const msPerTick = 1000 / CLK_TCK;
        cpuPct = ((deltaTicks * msPerTick) / span) * 100;
      }
    }

    return {
      pid: d.pid,
      comm: d.stat.comm,
      cmdline: d.cmdline,
      isKernel: d.isKernel,
      state: d.stat.state,
      ppid: d.stat.ppid,
      threads: d.stat.threads,
      cpuPct,
      rssBytes: d.stat.rssPages * PAGE_SIZE,
      containerId: d.containerId,
      containerName: d.containerId !== null ? (nameMap.get(d.containerId) ?? null) : null,
      cgroupIoRate: d.containerId !== null ? (ioRateByContainer.get(d.containerId) ?? null) : null,
    };
  });

  processes.sort((a, b) => {
    if (a.cpuPct === null && b.cpuPct === null) return 0;
    if (a.cpuPct === null) return 1;
    if (b.cpuPct === null) return -1;
    return b.cpuPct - a.cpuPct;
  });

  const newTicks = new Map<number, PidTick>();
  for (const d of details) {
    newTicks.set(d.pid, { ticks: d.stat.utime + d.stat.stime, starttime: d.stat.starttime });
  }
  samples.push({ ts: sampleTs, ticks: newTicks, io: ioTotals });
  globalForProcesses.__processSamples = samples.slice(-MAX_SAMPLES);

  return { ts: sampleTs, cores, memTotal, processes, scanned, skipped };
}

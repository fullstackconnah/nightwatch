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
  __processCache?: ProcessCacheEntry;
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

  const prev = globalForProcesses.__processCache;
  const now0 = Date.now();
  const prevUsable = prev && now0 - prev.ts < STALE_BASELINE_MS;

  let baselineTicks: Map<number, PidTick>;
  let baselineTs: number;
  if (prevUsable) {
    baselineTicks = prev!.ticks;
    baselineTs = prev!.ts;
  } else {
    // No usable previous sample (cold start, or the cached one is stale) —
    // take an internal throwaway sample now and wait, so the sample we
    // actually RETURN already has a real CPU delta instead of a screen of
    // dashes on the very first response.
    baselineTicks = await sampleTicksOnly(pids);
    // Stamp the baseline AFTER those reads finish, not from before them:
    // sampleTicksOnly spends tens of ms crossing ~476 pids, and timing the
    // interval from the earlier `now0` would inflate deltaMs and understate
    // every CPU figure in the first response the reader ever sees. Steady-state
    // polls are already correct — they diff two `sampleTs` values, both stamped
    // at the same point in the cycle.
    baselineTs = Date.now();
    await delay(SAMPLE_DELAY_MS);
  }
  const baselineIo = prevUsable ? prev!.io : new Map<string, number>();

  const { details, scanned, skipped, ioTotals } = await scanOnce(pids);
  const sampleTs = Date.now();
  const deltaMs = sampleTs - baselineTs;

  const containerIds = new Set(details.map((d) => d.containerId).filter((id): id is string => id !== null));
  const nameMap = await resolveContainerNames(containerIds);

  // cgroup io rate: diff this scan's per-container cumulative total against
  // the previous cached total for that container, over the same interval as
  // the CPU delta. Missing on either side, a non-positive interval, or a
  // negative delta (cgroup recreated e.g. container restarted) => null,
  // never a fabricated rate.
  const ioRateByContainer = new Map<string, number | null>();
  for (const id of containerIds) {
    const nowTotal = ioTotals.get(id);
    const prevTotal = baselineIo.get(id);
    if (nowTotal === undefined) {
      ioRateByContainer.set(id, null);
      continue;
    }
    if (prevTotal === undefined || deltaMs <= 0) {
      ioRateByContainer.set(id, null);
      continue;
    }
    const delta = nowTotal - prevTotal;
    ioRateByContainer.set(id, delta >= 0 ? (delta * 1000) / deltaMs : null);
  }

  const processes: ProcessRow[] = details.map((d) => {
    const baseline = baselineTicks.get(d.pid);
    let cpuPct: number | null = null;
    // A pid reused since the baseline sample (recycled onto a different
    // process) carries a different starttime — without this check a recycled
    // pid's tick counter would appear to have jumped from 0 to a large value
    // instantly, producing a wild bogus spike instead of the correct "no
    // baseline yet" null.
    if (baseline && baseline.starttime === d.stat.starttime && deltaMs > 0) {
      const nowTicks = d.stat.utime + d.stat.stime;
      const deltaTicks = nowTicks - baseline.ticks;
      if (deltaTicks >= 0) {
        // One busy core = 100 (Docker-style, matching TelemetryRow.cpuPct).
        // Sanity check: CLK_TCK=100 means 1 tick = 10ms, so 100 ticks spent
        // over a 1000ms window is a fully-busy core -> 100.
        const msPerTick = 1000 / CLK_TCK;
        cpuPct = ((deltaTicks * msPerTick) / deltaMs) * 100;
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
  globalForProcesses.__processCache = { ts: sampleTs, ticks: newTicks, io: ioTotals };

  return { ts: sampleTs, cores, memTotal, processes, scanned, skipped };
}

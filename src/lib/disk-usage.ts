import fs from "node:fs";
import { spawn } from "node:child_process";
import { getHostVitals, parseAllMountpoints, HOST_PROC, HOST_ROOTFS, type HostVitals } from "@/lib/host-metrics";

/**
 * Per-disk "what's using the space" breakdown for the Resources page's HOST
 * DISK panel. Shells out to `du` on the primary mountpoint of a disk GROUP
 * (never a client-supplied path — see scanDiskUsage), excluding any child
 * that is itself a mountpoint of a different filesystem so `du -x` never
 * gets a pseudo-filesystem (proc, sysfs, tmpfs, ...) passed as an explicit
 * argument, which is the one case where -x fails to prune it (see
 * parseAllMountpoints in host-metrics.ts for why).
 */

type DiskGroup = HostVitals["disk"][number];

export interface DiskUsageEntry {
  name: string;
  bytes: number;
  kind: "dir" | "file" | "mount";
}

export interface DiskUsageScan {
  label: string;
  scannedAt: number;
  durationMs: number;
  entries: DiskUsageEntry[]; // top 10 desc
  otherBytes: number; // sum of entries beyond top 10
  /**
   * max(0, group.used - (all scanned + otherBytes)), attributed to ONE of these two
   * buckets depending on why it's missing — never invented, and never both at once:
   *  - unreadableBytes: du hit "permission denied" (deniedCount > 0) — the dashboard's
   *    unprivileged user genuinely cannot see this data, so it's dishonest to call it
   *    "filesystem overhead". unaccountedBytes stays 0 in this case.
   *  - unaccountedBytes: deniedCount === 0 — real fs overhead (inode/block accounting,
   *    sparse files, races) with no permission story behind it.
   */
  unaccountedBytes: number;
  unreadableBytes: number;
  /** Count of "permission denied" lines du reported while scanning. */
  deniedCount: number;
  /** (sum of entries + otherBytes) / usedBytes * 100 — how much of `used` this scan actually accounted for. */
  readablePct: number;
  usedBytes: number;
  totalBytes: number;
  partial: boolean;
  error: string | null;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const SCAN_TIMEOUT_MS = 300_000;
const TOP_N = 10;

interface CacheEntry {
  data: DiskUsageScan;
  ts: number;
}

const globalForDiskUsage = globalThis as unknown as {
  __diskUsageCache?: Map<string, CacheEntry>;
  __diskUsageInFlight?: Map<string, Promise<DiskUsageScan>>;
};
const cache = globalForDiskUsage.__diskUsageCache ?? new Map<string, CacheEntry>();
globalForDiskUsage.__diskUsageCache = cache;
const inFlight = globalForDiskUsage.__diskUsageInFlight ?? new Map<string, Promise<DiskUsageScan>>();
globalForDiskUsage.__diskUsageInFlight = inFlight;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Every mountpoint in the HOST's mount namespace (not the container's own),
 * unfiltered — see parseAllMountpoints. Falls back to the container's own
 * /proc/mounts (dev mode / PID-1 unreadable) which won't see the host's
 * pseudo-mounts, so exclusion is best-effort in that fallback path.
 */
function getAllHostMountpoints(): Set<string> {
  try {
    const content = fs.readFileSync(`${HOST_PROC}/1/mounts`, "utf8");
    return new Set(parseAllMountpoints(content));
  } catch {
    try {
      const content = fs.readFileSync("/proc/mounts", "utf8");
      return new Set(parseAllMountpoints(content));
    } catch {
      return new Set();
    }
  }
}

/**
 * The group's primary mountpoint to scan. Per-mount `used` isn't exposed by
 * host-metrics's disk grouping (it aggregates across a physical disk's
 * partitions) and this module does not refactor host-metrics to add it, so
 * this always falls to the "/" / mounts[0] branch in practice.
 */
function pickPrimaryMountpoint(group: DiskGroup): string {
  const mounts = group.mounts ?? [group.mount];
  if (mounts.includes("/")) return "/";
  return mounts[0];
}

interface ChildInfo {
  name: string;
  fullPath: string; // HOST_ROOTFS-prefixed, container-visible path
  kind: "dir" | "file";
}

/**
 * Runs `du -sxk -- <paths...>` with a hard timeout; never throws.
 *
 * The runtime image's `du` is BusyBox (Alpine), not GNU coreutils — it has no long
 * options at all, so `--block-size=1`/`--apparent-size` are unrecognized and fail the
 * whole invocation. `-k` reports 1024-byte ALLOCATED blocks (matches statfs `used`
 * semantics, unlike `-b` apparent-size which over-reports vs df); sizes are multiplied
 * by 1024 below to get bytes. `-s`/`-x` are both supported by BusyBox.
 */
function runDu(
  paths: string[],
  timeoutMs: number,
): Promise<{ sizes: Map<string, number>; partial: boolean; error: string | null; deniedCount: number }> {
  return new Promise((resolve) => {
    if (paths.length === 0) {
      resolve({ sizes: new Map(), partial: false, error: null, deniedCount: 0 });
      return;
    }
    let child;
    try {
      child = spawn("du", ["-sxk", "--", ...paths], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ sizes: new Map(), partial: false, error: errMsg(e), deniedCount: 0 });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnError: string | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    // stderr is captured (not discarded) so permission-denied paths can be counted and
    // honestly labeled rather than silently folded into "unaccounted".
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (e) => {
      spawnError = errMsg(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const sizes = new Map<string, number>();
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const tabIdx = trimmed.indexOf("\t");
        if (tabIdx === -1) continue;
        const blocks = Number(trimmed.slice(0, tabIdx));
        const p = trimmed.slice(tabIdx + 1);
        if (!isNaN(blocks)) sizes.set(p, blocks * 1024);
      }
      const deniedCount = (stderr.match(/permission denied/gi) ?? []).length;
      resolve({ sizes, partial: timedOut, error: spawnError, deniedCount });
    });
  });
}

function emptyResult(label: string, group: DiskGroup, startedAt: number, error: string): DiskUsageScan {
  return {
    label,
    scannedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    entries: [],
    otherBytes: 0,
    unaccountedBytes: Math.max(0, group.used),
    unreadableBytes: 0,
    deniedCount: 0,
    readablePct: 0,
    usedBytes: group.used,
    totalBytes: group.total,
    partial: true,
    error,
  };
}

async function performScan(label: string, group: DiskGroup): Promise<DiskUsageScan> {
  const startedAt = Date.now();
  try {
    const primary = pickPrimaryMountpoint(group);
    const mountpoints = getAllHostMountpoints();
    const target = primary === "/" ? HOST_ROOTFS : `${HOST_ROOTFS}${primary}`;

    let names: string[];
    try {
      names = fs.readdirSync(target);
    } catch (e) {
      return emptyResult(label, group, startedAt, `readdir failed: ${errMsg(e)}`);
    }

    const children: ChildInfo[] = [];
    for (const name of names) {
      const childHostPath = primary === "/" ? `/${name}` : `${primary}/${name}`;
      // A child that is itself a mountpoint of a different filesystem must never be
      // passed to du as an explicit argument (see module docstring) — and it isn't
      // part of this group's statfs `used` total either, so it's simply omitted
      // rather than shown with an invented size.
      if (mountpoints.has(childHostPath)) continue;

      const fullPath = `${target}/${name}`;
      let st: fs.Stats;
      try {
        st = fs.lstatSync(fullPath);
      } catch {
        continue; // permission denied or vanished mid-scan — skip silently
      }
      children.push({ name, fullPath, kind: st.isDirectory() ? "dir" : "file" });
    }

    const dirChildren = children.filter((c) => c.kind === "dir");
    const fileChildren = children.filter((c) => c.kind === "file");

    const {
      sizes: duSizes,
      partial: duPartial,
      error: duError,
      deniedCount,
    } = await runDu(dirChildren.map((c) => c.fullPath), SCAN_TIMEOUT_MS);

    const entries: DiskUsageEntry[] = [];
    for (const c of dirChildren) {
      const bytes = duSizes.get(c.fullPath);
      if (bytes == null && duPartial) continue; // scan was killed before reaching this one
      entries.push({ name: c.name, bytes: bytes ?? 0, kind: "dir" });
    }
    for (const c of fileChildren) {
      let bytes = 0;
      try {
        bytes = fs.lstatSync(c.fullPath).blocks * 512;
      } catch {
        continue;
      }
      entries.push({ name: c.name, bytes, kind: "file" });
    }

    entries.sort((a, b) => b.bytes - a.bytes);
    const top = entries.slice(0, TOP_N);
    const rest = entries.slice(TOP_N);
    const otherBytes = rest.reduce((a, e) => a + e.bytes, 0);
    const scannedTotal = top.reduce((a, e) => a + e.bytes, 0) + otherBytes;
    const remainder = Math.max(0, group.used - scannedTotal);
    // Attribute the remainder honestly: if du hit permission-denied paths, that's why
    // space is missing — label it as unreadable, not generic "filesystem overhead".
    const unreadableBytes = deniedCount > 0 ? remainder : 0;
    const unaccountedBytes = deniedCount > 0 ? 0 : remainder;
    const readablePct = group.used > 0 ? Math.min(100, (scannedTotal / group.used) * 100) : 100;

    return {
      label,
      scannedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      entries: top,
      otherBytes,
      unaccountedBytes,
      unreadableBytes,
      deniedCount,
      readablePct,
      usedBytes: group.used,
      totalBytes: group.total,
      partial: duPartial,
      error: duPartial ? "scan timed out" : duError,
    };
  } catch (e) {
    return emptyResult(label, group, startedAt, errMsg(e));
  }
}

/**
 * Scans the disk group identified by `label` (a group label from
 * getHostVitals().disk, e.g. "nvme0n1" — NEVER a client-supplied filesystem
 * path). Returns null for an unknown label. Cached in-process for 30 minutes;
 * `opts.refresh` bypasses the cache. Concurrent requests for the same label
 * share one in-flight scan instead of spawning `du` twice.
 */
export async function scanDiskUsage(label: string, opts?: { refresh?: boolean }): Promise<DiskUsageScan | null> {
  const vitals = await getHostVitals();
  const group = vitals.disk.find((d) => d.mount === label);
  if (!group) return null;

  if (!opts?.refresh) {
    const cached = cache.get(label);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;
  }

  const existing = inFlight.get(label);
  if (existing) return existing;

  const promise = performScan(label, group)
    .then((data) => {
      cache.set(label, { data, ts: Date.now() });
      return data;
    })
    .finally(() => {
      inFlight.delete(label);
    });
  inFlight.set(label, promise);
  return promise;
}

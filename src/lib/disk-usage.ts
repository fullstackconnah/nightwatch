import fs from "node:fs";
import path from "node:path";
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
  /** Absolute host-relative path (e.g. "/mnt/docker/downloads") — populated for
   *  every dir/file entry so a client can drill into it (GET
   *  /api/resources/contents?path=) or pin it (POST /api/resources/pins)
   *  without reconstructing the path itself. Optional only for shape
   *  compatibility with any caller built before this field existed. */
  path?: string;
}

export interface DiskUsageScan {
  label: string;
  scannedAt: number;
  durationMs: number;
  entries: DiskUsageEntry[]; // top 10 desc
  otherBytes: number; // sum of entries beyond top 10
  /** Absolute host-relative path this scan describes — the disk group's primary
   *  mountpoint for a root scan (scanDiskUsage), or the requested subpath for a
   *  drill-down scan (scanDirectoryContents). Optional only for shape
   *  compatibility with any caller built before this field existed. */
  path?: string;
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
export function getAllHostMountpoints(): Set<string> {
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

    const entryPath = (name: string) => (primary === "/" ? `/${name}` : `${primary}/${name}`);

    const entries: DiskUsageEntry[] = [];
    for (const c of dirChildren) {
      const bytes = duSizes.get(c.fullPath);
      if (bytes == null && duPartial) continue; // scan was killed before reaching this one
      entries.push({ name: c.name, bytes: bytes ?? 0, kind: "dir", path: entryPath(c.name) });
    }
    for (const c of fileChildren) {
      let bytes = 0;
      try {
        bytes = fs.lstatSync(c.fullPath).blocks * 512;
      } catch {
        continue;
      }
      entries.push({ name: c.name, bytes, kind: "file", path: entryPath(c.name) });
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
      path: primary,
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

/* -----------------------------------------------------------------------
 * Path-based drill-down (G5): scans an arbitrary directory one level deep,
 * for any depth below a disk group's root. Unlike scanDiskUsage above (which
 * is keyed by a trusted disk-group label and reads its "used" total from
 * host-metrics's statfs pass) this is keyed by a CLIENT-SUPPLIED absolute
 * path, so every entry point validates it first via resolveAbsolutePath and
 * every scan reports its own ground-truth "usedBytes" — a `du -sxk` on the
 * scanned directory itself, requested in the SAME batched du invocation as
 * its children so this costs one extra path in one existing process rather
 * than a second spawn. That total (not a statfs figure — no filesystem-level
 * "capacity" exists for an arbitrary directory) is what unaccountedBytes/
 * unreadableBytes/readablePct are measured against, preserving the same
 * honesty story scanDiskUsage tells at the disk-group root.
 * --------------------------------------------------------------------- */

/**
 * Validates and normalizes a client-supplied absolute path before it ever
 * reaches the filesystem. `path.posix.normalize` cannot climb above "/" for a
 * rooted input (excess ".." at the root collapse to root, they don't go
 * negative), so a traversal attempt like "/../../etc" normalizes to "/etc" —
 * still safely inside HOST_ROOTFS once prefixed, never outside it. Returns
 * null (→ 400 at the route) for anything malformed rather than guessing.
 */
export function resolveAbsolutePath(requested: string): string | null {
  if (typeof requested !== "string" || requested.length === 0 || !requested.startsWith("/")) return null;
  const normalized = path.posix.normalize(requested);
  if (normalized.length > 1 && normalized.endsWith("/")) return null;
  return normalized;
}

function hostPathFor(absolutePath: string): string {
  return absolutePath === "/" ? HOST_ROOTFS : `${HOST_ROOTFS}${absolutePath}`;
}

function childAbsolutePath(parentAbs: string, name: string): string {
  return parentAbs === "/" ? `/${name}` : `${parentAbs}/${name}`;
}

async function performPathScan(absolutePath: string): Promise<DiskUsageScan> {
  const startedAt = Date.now();
  const target = hostPathFor(absolutePath);

  try {
    const mountpoints = getAllHostMountpoints();

    let names: string[];
    try {
      names = fs.readdirSync(target);
    } catch (e) {
      return {
        label: absolutePath,
        path: absolutePath,
        scannedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        entries: [],
        otherBytes: 0,
        unaccountedBytes: 0,
        unreadableBytes: 0,
        deniedCount: 0,
        readablePct: 0,
        usedBytes: 0,
        totalBytes: 0,
        partial: true,
        error: `readdir failed: ${errMsg(e)}`,
      };
    }

    const children: ChildInfo[] = [];
    for (const name of names) {
      const childAbs = childAbsolutePath(absolutePath, name);
      // Never pass a different filesystem's mountpoint to du (see performScan's
      // module docstring for the same rule at the disk-group root) — and never
      // let the drill-down itself step onto one either.
      if (mountpoints.has(childAbs)) continue;

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

    // The scanned directory's own path rides in the SAME du call as its
    // children (one process, one timeout) so its recursive total doubles as
    // the ground truth `usedBytes` below, the same role group.used plays for
    // a root scan.
    const {
      sizes: duSizes,
      partial: duPartial,
      error: duError,
      deniedCount,
    } = await runDu([...dirChildren.map((c) => c.fullPath), target], SCAN_TIMEOUT_MS);

    const entries: DiskUsageEntry[] = [];
    for (const c of dirChildren) {
      const bytes = duSizes.get(c.fullPath);
      if (bytes == null && duPartial) continue;
      entries.push({ name: c.name, bytes: bytes ?? 0, kind: "dir", path: childAbsolutePath(absolutePath, c.name) });
    }
    for (const c of fileChildren) {
      let bytes = 0;
      try {
        bytes = fs.lstatSync(c.fullPath).blocks * 512;
      } catch {
        continue;
      }
      entries.push({ name: c.name, bytes, kind: "file", path: childAbsolutePath(absolutePath, c.name) });
    }

    entries.sort((a, b) => b.bytes - a.bytes);
    const top = entries.slice(0, TOP_N);
    const rest = entries.slice(TOP_N);
    const otherBytes = rest.reduce((a, e) => a + e.bytes, 0);
    const scannedTotal = top.reduce((a, e) => a + e.bytes, 0) + otherBytes;
    const groundTruth = duSizes.get(target);
    const usedBytes = groundTruth ?? scannedTotal;
    const remainder = Math.max(0, usedBytes - scannedTotal);
    const unreadableBytes = deniedCount > 0 ? remainder : 0;
    const unaccountedBytes = deniedCount > 0 ? 0 : remainder;
    const readablePct = usedBytes > 0 ? Math.min(100, (scannedTotal / usedBytes) * 100) : 100;

    return {
      label: absolutePath,
      path: absolutePath,
      scannedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      entries: top,
      otherBytes,
      unaccountedBytes,
      unreadableBytes,
      deniedCount,
      readablePct,
      usedBytes,
      // No filesystem "capacity" exists for an arbitrary directory — totalBytes
      // mirrors usedBytes so any caller reading it sees a consistent "100% of
      // itself" rather than an invented ceiling.
      totalBytes: usedBytes,
      partial: duPartial,
      error: duPartial ? "scan timed out" : duError,
    };
  } catch (e) {
    return {
      label: absolutePath,
      path: absolutePath,
      scannedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      entries: [],
      otherBytes: 0,
      unaccountedBytes: 0,
      unreadableBytes: 0,
      deniedCount: 0,
      readablePct: 0,
      usedBytes: 0,
      totalBytes: 0,
      partial: true,
      error: errMsg(e),
    };
  }
}

const globalForDiskPathScan = globalThis as unknown as {
  __diskPathCache?: Map<string, CacheEntry>;
  __diskPathInFlight?: Map<string, Promise<DiskUsageScan>>;
};
const pathCache = globalForDiskPathScan.__diskPathCache ?? new Map<string, CacheEntry>();
globalForDiskPathScan.__diskPathCache = pathCache;
const pathInFlight = globalForDiskPathScan.__diskPathInFlight ?? new Map<string, Promise<DiskUsageScan>>();
globalForDiskPathScan.__diskPathInFlight = pathInFlight;

export type DirectoryScanResult =
  | { ok: true; scan: DiskUsageScan }
  | { ok: false; status: 400; error: string };

/**
 * Scans an arbitrary directory (client-supplied `absolutePath`, validated via
 * resolveAbsolutePath) one level deep — the CONTENTS drill-down's "enter this
 * folder" request, and also how the PINNED panel learns a pinned folder's
 * current size (it just reads `.usedBytes` off the same cached response, see
 * disk-pinned.tsx). Cached per-path for 30 minutes, same TTL and in-flight
 * dedupe pattern as scanDiskUsage, in a separate cache keyed by path rather
 * than disk-group label.
 */
export async function scanDirectoryContents(
  absolutePath: string,
  opts?: { refresh?: boolean },
): Promise<DirectoryScanResult> {
  const normalized = resolveAbsolutePath(absolutePath);
  if (!normalized) return { ok: false, status: 400, error: "invalid or unsafe path" };

  if (!opts?.refresh) {
    const cached = pathCache.get(normalized);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return { ok: true, scan: cached.data };
  }

  const existing = pathInFlight.get(normalized);
  if (existing) return { ok: true, scan: await existing };

  const promise = performPathScan(normalized)
    .then((data) => {
      pathCache.set(normalized, { data, ts: Date.now() });
      return data;
    })
    .finally(() => {
      pathInFlight.delete(normalized);
    });
  pathInFlight.set(normalized, promise);
  return { ok: true, scan: await promise };
}

import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { HOST_ROOTFS } from "@/lib/host-metrics";
import { getAllHostMountpoints, resolveAbsolutePath } from "@/lib/disk-usage";

/**
 * On-demand recursive scans for the CONTENTS drill-down's "Find largest
 * files" and "Find duplicates" actions (G5). Both are heavy, opt-in jobs —
 * never run automatically — so they run as a background async task tracked
 * on globalThis (mirrors metrics-history.ts's globalForHistory pattern for
 * HMR-safe module state) rather than blocking the POST request that starts
 * them. The client polls GET for {state, progress, result}.
 *
 * Caps (shared by both kinds, enforced inside walkFiles): a 60s wall-clock
 * budget, 100k directory entries visited, never crossing into a different
 * filesystem's mountpoint (proc/sys/tmpfs and any other real disk alike —
 * the same -x boundary disk-usage.ts's du calls respect), and never
 * following a symlink (skipped outright, neither sized nor descended into).
 * A cap hit is reported honestly to the client as a floor, not a census.
 */

const SCAN_BUDGET_MS = 60_000;
const MAX_ENTRIES = 100_000;
const YIELD_EVERY = 500; // entries between event-loop yields, so a poll can land mid-walk
const JOB_TTL_MS = 30 * 60 * 1000;
const TOP_FILES = 100;
const TOP_GROUPS = 50;
const MIN_DUP_SIZE = 1024 * 1024; // 1 MiB — smaller files aren't worth the hashing cost
const HASH_CHUNK = 1024 * 1024; // 1 MiB head + 1 MiB tail
const MAX_HASH_FILES = 5000; // bounds duplicate-hashing I/O independent of the walk's own caps

export type ScanJobKind = "largest-files" | "duplicates";
export type ScanJobState = "running" | "done" | "error";
export type ScanCapReason = "entries" | "time" | null;

export interface LargestFileEntry {
  /** Path relative to the scan root, e.g. "downloads/movie.mkv". */
  path: string;
  bytes: number;
  mtime: number;
}

export interface LargestFilesResult {
  root: string;
  files: LargestFileEntry[];
  entriesScanned: number;
  capHit: ScanCapReason;
  durationMs: number;
}

export interface DuplicateGroup {
  size: number;
  /** sha256 of the first+last 1MiB — informational, not proof of a byte-exact match. */
  hash: string;
  /** Paths relative to the scan root. */
  files: string[];
  wastedBytes: number;
}

export interface DuplicatesResult {
  root: string;
  groups: DuplicateGroup[];
  totalWastedBytes: number;
  entriesScanned: number;
  filesHashed: number;
  capHit: ScanCapReason;
  /** True when MAX_HASH_FILES (or the walk's own time budget, doubled) cut the
   *  hashing pass short — a distinct cap from `capHit`, which is about the
   *  directory walk, not the hashing pass over its results. */
  hashCapHit: boolean;
  durationMs: number;
}

export interface ScanJob {
  id: string;
  kind: ScanJobKind;
  root: string;
  state: ScanJobState;
  progress: { entriesScanned: number };
  result: LargestFilesResult | DuplicatesResult | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

const globalForDiskScan = globalThis as unknown as {
  __diskScanJobs?: Map<string, ScanJob>;
  __diskScanLatestByKind?: Map<ScanJobKind, string>;
};

function jobs(): Map<string, ScanJob> {
  if (!globalForDiskScan.__diskScanJobs) globalForDiskScan.__diskScanJobs = new Map();
  return globalForDiskScan.__diskScanJobs;
}
function latestByKind(): Map<ScanJobKind, string> {
  if (!globalForDiskScan.__diskScanLatestByKind) globalForDiskScan.__diskScanLatestByKind = new Map();
  return globalForDiskScan.__diskScanLatestByKind;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isExpired(job: ScanJob): boolean {
  return job.state !== "running" && job.finishedAt != null && Date.now() - job.finishedAt > JOB_TTL_MS;
}

/** The most recently started job of `kind`, or null once it has finished and
 *  aged out past JOB_TTL_MS. Expired jobs are dropped from the store here
 *  (lazily, on next lookup) rather than on a timer — this app has no
 *  background scheduler and a 30-minute-old job object is a few hundred
 *  bytes, not worth one. */
export function getLatestJob(kind: ScanJobKind): ScanJob | null {
  const id = latestByKind().get(kind);
  if (!id) return null;
  const job = jobs().get(id);
  if (!job) return null;
  if (isExpired(job)) {
    jobs().delete(id);
    latestByKind().delete(kind);
    return null;
  }
  return job;
}

export function getJob(id: string): ScanJob | null {
  const job = jobs().get(id);
  if (!job) return null;
  if (isExpired(job)) {
    jobs().delete(id);
    return null;
  }
  return job;
}

function relFromRoot(rootAbs: string, childAbs: string): string {
  const rel = rootAbs === "/" ? childAbs : childAbs.slice(rootAbs.length);
  return rel.replace(/^\/+/, "");
}

function hostPathFor(absolutePath: string): string {
  return absolutePath === "/" ? HOST_ROOTFS : `${HOST_ROOTFS}${absolutePath}`;
}

/**
 * Iterative (no recursion — a 60s budget on a deep media tree can visit tens
 * of thousands of directories, well past a comfortable call-stack depth)
 * walk of a host-rootfs directory tree. Yields to the event loop every
 * YIELD_EVERY entries so this job's own GET poll — and every other request
 * this single Node process is serving — never stalls behind it.
 */
async function walkFiles(
  rootAbs: string,
  onFile: (absPath: string, bytes: number, mtimeMs: number) => void,
  onProgress: (entriesScanned: number) => void,
): Promise<{ entriesScanned: number; capHit: ScanCapReason }> {
  const started = Date.now();
  const mountpoints = getAllHostMountpoints();
  const stack: string[] = [rootAbs];
  let entries = 0;
  let capHit: ScanCapReason = null;

  outer: while (stack.length > 0) {
    if (Date.now() - started > SCAN_BUDGET_MS) {
      capHit = "time";
      break;
    }
    if (entries >= MAX_ENTRIES) {
      capHit = "entries";
      break;
    }

    const dirAbs = stack.pop()!;
    const dirHostPath = hostPathFor(dirAbs);
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dirHostPath, { withFileTypes: true });
    } catch {
      continue; // permission denied or vanished mid-walk — skip silently
    }

    for (const d of dirents) {
      if (Date.now() - started > SCAN_BUDGET_MS) {
        capHit = "time";
        break outer;
      }
      if (entries >= MAX_ENTRIES) {
        capHit = "entries";
        break outer;
      }
      if (d.isSymbolicLink()) continue; // never follow

      entries++;
      if (entries % YIELD_EVERY === 0) {
        onProgress(entries);
        await new Promise((resolve) => setImmediate(resolve));
      }

      const childAbs = dirAbs === "/" ? `/${d.name}` : `${dirAbs}/${d.name}`;

      if (d.isDirectory()) {
        if (mountpoints.has(childAbs)) continue; // different filesystem — stay on this one, matches du -x elsewhere
        stack.push(childAbs);
      } else if (d.isFile()) {
        const childHostPath = `${dirHostPath}/${d.name}`;
        try {
          const st = fs.lstatSync(childHostPath);
          onFile(childAbs, st.blocks * 512, st.mtimeMs);
        } catch {
          // vanished or permission denied — skip
        }
      }
      // sockets/fifos/devices are neither sized nor descended into
    }
  }

  onProgress(entries);
  return { entriesScanned: entries, capHit };
}

async function runLargestFiles(job: ScanJob, rootAbs: string): Promise<void> {
  const started = Date.now();
  // TOP_FILES is small (100), so a sorted-insert-and-trim on every candidate
  // is cheap even across 100k files — no need for a real heap.
  const top: LargestFileEntry[] = [];
  function consider(absPath: string, bytes: number, mtimeMs: number) {
    if (top.length >= TOP_FILES && bytes <= top[top.length - 1].bytes) return;
    const entry: LargestFileEntry = { path: relFromRoot(rootAbs, absPath), bytes, mtime: mtimeMs };
    const idx = top.findIndex((e) => e.bytes < bytes);
    if (idx === -1) top.push(entry);
    else top.splice(idx, 0, entry);
    if (top.length > TOP_FILES) top.length = TOP_FILES;
  }

  try {
    const { entriesScanned, capHit } = await walkFiles(
      rootAbs,
      consider,
      (n) => {
        job.progress.entriesScanned = n;
      },
    );
    job.result = { root: rootAbs, files: top, entriesScanned, capHit, durationMs: Date.now() - started };
    job.state = "done";
  } catch (e) {
    job.error = errMsg(e);
    job.state = "error";
  } finally {
    job.finishedAt = Date.now();
  }
}

/** Hashes the first 1MiB and, for files larger than that, the last 1MiB —
 *  never the whole file, so a multi-GB media file costs at most 2MiB of
 *  reads. This is a strong "probably identical" signal, not a byte-exact
 *  comparison; results must always be labeled accordingly (see
 *  disk-scan-jobs.tsx's copy). The file handle is opened, read, and closed
 *  within this one call — never held open across a job's poll boundary. */
async function hashHeadTail(hostPath: string, size: number): Promise<string | null> {
  let fd: fsp.FileHandle | null = null;
  try {
    fd = await fsp.open(hostPath, "r");
    const hash = crypto.createHash("sha256");

    const headLen = Math.min(HASH_CHUNK, size);
    const headBuf = Buffer.alloc(headLen);
    await fd.read(headBuf, 0, headLen, 0);
    hash.update(headBuf);

    if (size > HASH_CHUNK) {
      const tailLen = Math.min(HASH_CHUNK, size);
      const tailStart = size - tailLen;
      const tailBuf = Buffer.alloc(tailLen);
      await fd.read(tailBuf, 0, tailLen, tailStart);
      hash.update(tailBuf);
    }

    return hash.digest("hex");
  } catch {
    return null; // unreadable — skip silently, same posture as du's denied paths
  } finally {
    if (fd) await fd.close().catch(() => {});
  }
}

async function runDuplicates(job: ScanJob, rootAbs: string): Promise<void> {
  const started = Date.now();
  const bySize = new Map<number, { hostPath: string; absPath: string }[]>();

  function consider(absPath: string, bytes: number) {
    if (bytes < MIN_DUP_SIZE) return;
    const list = bySize.get(bytes) ?? [];
    list.push({ hostPath: hostPathFor(absPath), absPath });
    bySize.set(bytes, list);
  }

  try {
    const { entriesScanned, capHit } = await walkFiles(
      rootAbs,
      consider,
      (n) => {
        job.progress.entriesScanned = n;
      },
    );

    // Only size-groups with 2+ members can possibly be duplicates. Hash the
    // biggest potential waste first (size * count) so MAX_HASH_FILES, if it
    // binds, spends its budget where the payoff is largest.
    const sizeGroups = [...bySize.entries()].filter(([, list]) => list.length >= 2);
    sizeGroups.sort((a, b) => b[0] * b[1].length - a[0] * a[1].length);

    let filesHashed = 0;
    let hashCapHit = false;
    const groups: DuplicateGroup[] = [];

    outer: for (const [size, candidates] of sizeGroups) {
      const hashToFiles = new Map<string, string[]>();
      for (const c of candidates) {
        if (filesHashed >= MAX_HASH_FILES || Date.now() - started > SCAN_BUDGET_MS * 2) {
          hashCapHit = true;
          break outer;
        }
        const hash = await hashHeadTail(c.hostPath, size);
        filesHashed++;
        if (filesHashed % 200 === 0) await new Promise((resolve) => setImmediate(resolve));
        if (hash == null) continue;
        const list = hashToFiles.get(hash) ?? [];
        list.push(c.absPath);
        hashToFiles.set(hash, list);
      }
      for (const [hash, files] of hashToFiles) {
        if (files.length < 2) continue;
        groups.push({
          size,
          hash,
          files: files.map((f) => relFromRoot(rootAbs, f)),
          wastedBytes: size * (files.length - 1),
        });
      }
    }

    groups.sort((a, b) => b.wastedBytes - a.wastedBytes);
    // The headline total is honest about everything FOUND, even though the
    // list itself is truncated to the top 50 groups shown.
    const totalWastedBytes = groups.reduce((a, g) => a + g.wastedBytes, 0);

    job.result = {
      root: rootAbs,
      groups: groups.slice(0, TOP_GROUPS),
      totalWastedBytes,
      entriesScanned,
      filesHashed,
      capHit,
      hashCapHit,
      durationMs: Date.now() - started,
    };
    job.state = "done";
  } catch (e) {
    job.error = errMsg(e);
    job.state = "error";
  } finally {
    job.finishedAt = Date.now();
  }
}

function newJobId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export type StartJobResult = { ok: true; job: ScanJob } | { ok: false; status: 400 | 409; error: string };

/**
 * Starts a background scan job for `kind` rooted at `root` (a client-supplied
 * absolute path, validated the same way the CONTENTS drill-down validates
 * one). Only one job per kind may run at a time — a second POST while one is
 * in flight returns 409 rather than queuing or racing two walkers over the
 * same tree. Returns immediately; the job continues on its own after this
 * function returns (fire-and-forget, matching metrics-history.ts's
 * recordMetricsHistoryTick posture for background work).
 */
export function startScanJob(kind: ScanJobKind, root: string): StartJobResult {
  const validatedRoot = resolveAbsolutePath(root);
  if (!validatedRoot) return { ok: false, status: 400, error: "invalid or unsafe path" };

  const existing = getLatestJob(kind);
  if (existing && existing.state === "running") {
    return { ok: false, status: 409, error: `a ${kind} scan is already running — wait for it to finish` };
  }

  const id = newJobId();
  const job: ScanJob = {
    id,
    kind,
    root: validatedRoot,
    state: "running",
    progress: { entriesScanned: 0 },
    result: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs().set(id, job);
  latestByKind().set(kind, id);

  void (kind === "largest-files" ? runLargestFiles(job, validatedRoot) : runDuplicates(job, validatedRoot));

  return { ok: true, job };
}

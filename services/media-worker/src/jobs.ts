// The job store and queue (PLAN B2, with D16, S4, S5, S9, M2, N4). One job runs at a time; jobs.json is rewritten
// atomically on every state change; boot recovery decides what an interrupted job becomes.
import { randomBytes } from "node:crypto";
import { accessSync, constants, lstatSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { dayLabel, diskMessage, enoughFor, freeBytes, type Dirs, type Statfs } from "./disk.ts";
import type { Guard } from "./fsguard.ts";
import { resolveMediaPath } from "./paths.ts";
import { readJson, writeJsonAtomic } from "./state.ts";
import { HOLD_DAYS } from "./sweet-spot.ts";
import { purgeHold, recoverSwap, rmQuiet, SwapError, undoSwap, type SwapFs, type SwapPlan } from "./swap.ts";
import type { BatchResponse, Job, JobsResponse, MediaFile } from "./types.ts";

export class JobError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** What jobs.json holds: the public Job plus journal fields that never leave the worker. */
export interface JobRecord extends Job {
  abs: string;
  container: string;
  srcIno?: number;
  srcSize?: number;
  srcMtimeMs?: number;
  srcMode?: number;
  outIno?: number;
  newIno?: number;
  newSize?: number;
  keepHold?: boolean;
  cancelRequested?: boolean;
}

const INTERNAL = ["abs", "container", "srcIno", "srcSize", "srcMtimeMs", "srcMode", "outIno", "newIno", "newSize", "keepHold", "cancelRequested"] as const;

export function publicJob(r: JobRecord): Job {
  const j = { ...r } as Record<string, unknown>;
  for (const k of INTERNAL) delete j[k];
  return j as unknown as Job;
}

/** H7: superseded finished records kept across a boot (the snapshot shows 50). */
export const KEEP_FINISHED = 200;
const PRUNABLE = new Set(["failed", "cancelled", "undone", "purged"]);
/** Drops the oldest superseded finished records. The newest record of a path (what jobFor shows, and the dashboard's
 *  "don't offer again" memory), `done` (hold and Undo) and a failed swap that kept its hold are never dropped. */
export function pruneFinished(all: JobRecord[]): JobRecord[] {
  const lastIdx = new Map<string, number>();
  all.forEach((j, i) => lastIdx.set(j.path, i));
  const drop = new Set(all.filter((j, i) => PRUNABLE.has(j.state) && !j.keepHold && lastIdx.get(j.path) !== i)
    .sort((a, b) => (b.finishedAt ?? b.createdAt ?? "").localeCompare(a.finishedAt ?? a.createdAt ?? "")).slice(KEEP_FINISHED));
  return drop.size ? all.filter((j) => !drop.has(j)) : all;
}

export const ACTIVE = new Set(["queued", "encoding", "verifying", "swapping"]);
const DAY_MS = 86_400_000;
const MAX_BATCH = 200;

export interface QueueOpts {
  stateDir: string;
  mediaRoot: string;
  dirs: Dirs;
  guard: Guard;
  fs: SwapFs;
  statfs: Statfs;
  enabled: boolean;
  ready: () => { ready: boolean; reason?: string };
  lookup: (path: string) => MediaFile | undefined;
  /** Runs one job to a terminal state; it patches the record itself. */
  run: (rec: JobRecord) => Promise<void>;
  /** Stops the running job's process group (Cancel, or shutdown). */
  kill: (id: string, why: "cancel" | "shutdown") => void;
  /** After a swap or Undo: re-probe the file and tell Jellyfin. */
  afterChange?: (rec: JobRecord) => Promise<void>;
  now?: () => Date;
  log?: (line: string) => void;
  tz?: string;
  uid?: number | undefined;
}

export function createQueue(opts: QueueOpts) {
  const now = opts.now ?? (() => new Date());
  const file = join(opts.stateDir, "jobs.json");
  const loaded = readJson<{ version: number; jobs: JobRecord[] }>(file, true)?.jobs ?? [];
  let jobs = pruneFinished(loaded);
  const uid = "uid" in opts ? opts.uid : process.getuid?.();
  let running: { id: string; done: Promise<void> } | null = null;
  let closed = false;
  let recovered = false;

  const save = () => writeJsonAtomic(file, { version: 1, jobs });
  if (jobs.length !== loaded.length) {
    try { save(); } catch (e) { opts.log?.(`jobs.json not saved after pruning: ${(e as Error).message}`); } // the next save writes it
  }
  const get = (id: string) => jobs.find((j) => j.id === id);
  const patch = (id: string, p: Partial<JobRecord>): JobRecord => {
    const r = get(id);
    if (!r) throw new JobError(404, "No such job");
    Object.assign(r, p);
    save();
    return r;
  };

  const plan = (r: JobRecord): SwapPlan => {
    const holdDir = join(opts.dirs.hold, r.id);
    return {
      src: r.abs, part: join(opts.dirs.work, `${r.id}.part`), holdRoot: opts.dirs.hold, holdDir,
      holdFile: join(holdDir, basename(r.abs)),
      srcIno: r.srcIno ?? -1, srcSize: r.srcSize ?? -1, srcMtimeMs: r.srcMtimeMs ?? -1, srcMode: r.srcMode ?? 0o644,
    };
  };

  const heldJobs = () => jobs.filter((j) => j.state === "done" && j.heldUntil);
  const heldBytes = () => heldJobs().reduce((n, j) => n + j.sourceBytes, 0);
  const earliestHeld = () => heldJobs().map((j) => j.heldUntil as string).sort()[0] ?? null;

  function pump(): void {
    if (closed || running) return;
    const next = jobs.find((j) => j.state === "queued");
    if (!next) return;
    const done = Promise.resolve()
      .then(() => opts.run(next))
      .catch((e: Error) => {
        opts.log?.(`job ${next.id} crashed: ${e.message}`);
        // Only before the swap: `swapping` and `done` are left for boot recover(), so a done record is never lost.
        const cur = jobs.find((x) => x.id === next.id);
        if (!cur || !["queued", "encoding", "verifying"].includes(cur.state)) return;
        // A failing state volume must not leave a film-sized .part on the media drive.
        if (cur.state !== "queued") {
          try { rmQuiet(opts.guard, opts.dirs.work, plan(cur).part); } catch (e3) { opts.log?.(`job ${next.id} part not removed: ${(e3 as Error).message}`); }
        }
        try { patch(next.id, { state: "failed", failedCheck: "encoder", finishedAt: now().toISOString() }); } catch (e2) { opts.log?.(`job ${next.id} not marked failed: ${(e2 as Error).message}`); }
      })
      .finally(() => { running = null; pump(); });
    running = { id: next.id, done };
  }

  function checkEnqueue(path: unknown): { rel: string; abs: string; f: MediaFile } {
    if (typeof path !== "string") throw new JobError(400, "path must be a string");
    const r = resolveMediaPath(path, opts.mediaRoot);
    if ("error" in r) throw new JobError(r.status, r.error);
    const f = opts.lookup(path);
    if (!f) throw new JobError(404, "Unknown file");
    const mine = jobs.filter((j) => j.path === path);
    if (mine.some((j) => ACTIVE.has(j.state))) throw new JobError(409, "Already queued");
    const held = mine.find((j) => j.state === "done");
    if (held) throw new JobError(409, `Already compressed; Undo it or wait until ${dayLabel(held.heldUntil as string, opts.tz)}`);
    if (f.verdict.kind !== "compress") throw new JobError(409, `Not compressible. ${f.verdict.reason}`);
    if (uid !== undefined) {
      // S5: the worker runs as PUID:PGID, so it can swap only a file it owns inside a folder it can write.
      try {
        if (lstatSync(r.abs).uid !== uid) throw new Error("owner");
        accessSync(dirname(r.abs), constants.W_OK);
      } catch {
        throw new JobError(409, "Owned by another user");
      }
    }
    if (!enoughFor(opts.statfs, opts.mediaRoot, f.bytes)) {
      throw new JobError(507, diskMessage(f.bytes, freeBytes(opts.statfs, opts.mediaRoot), earliestHeld(), opts.tz));
    }
    return { rel: path, abs: r.abs, f };
  }

  function enqueue(paths: unknown[], asBatch: boolean): Job[] | BatchResponse {
    if (!opts.enabled) throw new JobError(409, "Compress is off until calibration is done");
    const ready = opts.ready();
    if (!ready.ready) throw new JobError(409, `Compress is unavailable: ${ready.reason}`);
    recoverOnce(); // F1: the drive may have come up after boot
    if (paths.length < 1 || paths.length > MAX_BATCH) throw new JobError(400, `Send 1 to ${MAX_BATCH} paths`);
    if (new Set(paths).size !== paths.length) throw new JobError(400, "Duplicate path");
    const checked = paths.map(checkEnqueue); // all-or-nothing: the first problem is the answer
    const batchId = asBatch ? `b-${randomBytes(6).toString("hex")}` : undefined;
    const made = checked.map(({ rel, abs, f }): JobRecord => ({
      id: randomBytes(6).toString("hex"), path: rel, state: "queued", createdAt: now().toISOString(),
      crf: f.verdict.kind === "compress" ? f.verdict.crf : 0, sourceBytes: f.bytes, attempts: 0,
      abs, container: f.container, ...(batchId ? { batchId } : {}),
    }));
    jobs.push(...made);
    save();
    pump();
    const out = made.map(publicJob);
    return asBatch ? { batchId: batchId as string, jobs: out } : out;
  }

  function cancel(id: string): Job {
    const r = get(id);
    if (!r) throw new JobError(404, "No such job");
    if (r.state === "queued") return publicJob(patch(id, { state: "cancelled", finishedAt: now().toISOString() }));
    if (r.state === "swapping") throw new JobError(409, "it's already swapping in the new file");
    if (r.state !== "encoding" && r.state !== "verifying") throw new JobError(409, "It isn't running");
    patch(id, { cancelRequested: true });
    opts.kill(id, "cancel");
    return publicJob(r);
  }

  function purgeDue(): number {
    if (!opts.ready().ready) return 0; // F5: with the drive gone the delete would fail quietly and the job read as purged
    let n = 0;
    for (const r of heldJobs()) {
      if (Date.parse(r.heldUntil as string) >= now().getTime()) continue;
      try {
        purgeHold(opts.guard, plan(r));
        patch(r.id, { state: "purged" });
        n++;
      } catch (e) {
        opts.log?.(`purge of ${r.id} failed: ${(e as Error).message}`);
      }
    }
    return n;
  }

  /** Boot: decide what each interrupted job becomes (M2, N4), clear orphans, then start the queue. */
  function recover(): void {
    recovered = true;
    const t = now().toISOString();
    const requeue: JobRecord[] = [];
    for (const r of jobs) {
      const p = plan(r);
      if (r.state === "encoding" || r.state === "verifying") {
        rmQuiet(opts.guard, opts.dirs.work, p.part);
        r.attempts += 1;
        if (r.cancelRequested) Object.assign(r, { state: "cancelled", finishedAt: t }); // F6: don't re-encode a cancelled job
        else if (r.attempts >= 2) Object.assign(r, { state: "failed", failedCheck: "restart", finishedAt: t });
        else { r.state = "queued"; delete r.progress; requeue.push(r); }
      } else if (r.state === "swapping") {
        const rec = recoverSwap(opts.fs, opts.guard, p, r.outIno ?? -1);
        if (rec.result === "done") {
          Object.assign(r, {
            state: "done", newIno: rec.newIno, newSize: rec.newSize, outputBytes: rec.newSize, finishedAt: t,
            heldUntil: new Date(now().getTime() + HOLD_DAYS * DAY_MS).toISOString(),
          });
        } else {
          Object.assign(r, { state: "failed", failedCheck: "swap", error: rec.message, finishedAt: t, keepHold: rec.keepHold });
        }
      } else if (r.state === "done") {
        let holdThere = true;
        try { opts.fs.lstat(p.holdFile); } catch { holdThere = false; }
        let srcIno: number | null = null;
        try { srcIno = opts.fs.lstat(p.src).ino; } catch { /* gone */ }
        if (!holdThere && srcIno !== null && srcIno === r.srcIno) Object.assign(r, { state: "undone", finishedAt: t });
      }
    }
    // A job that was running goes to the head of the queue.
    jobs = [...requeue, ...jobs.filter((j) => !requeue.includes(j))];
    save();
    try {
      const live = new Set(jobs.filter((j) => j.state === "queued").map((j) => `${j.id}.part`));
      for (const f of readdirSync(opts.dirs.work)) if (!live.has(f)) rmQuiet(opts.guard, opts.dirs.work, join(opts.dirs.work, f));
    } catch { /* work/ not there yet: nothing to clear */ }
    purgeDue();
    pump();
  }
  const recoverOnce = () => { if (!recovered) recover(); };

  return {
    patch, get, plan, recover, recoverOnce, purgeDue, heldBytes, earliestHeld,
    all: () => jobs,
    isCancelRequested: (id: string) => Boolean(get(id)?.cancelRequested),

    snapshot(compress: { enabled: boolean; ready: boolean; reason?: string }): JobsResponse {
      const current = jobs.find((j) => j.state === "encoding" || j.state === "verifying" || j.state === "swapping") ?? null;
      const recent = jobs.filter((j) => !ACTIVE.has(j.state))
        .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt)).slice(0, 50);
      return {
        compressEnabled: compress.enabled, compressReady: compress.ready, ...(compress.reason ? { reason: compress.reason } : {}),
        current: current ? publicJob(current) : null,
        queue: jobs.filter((j) => j.state === "queued").map(publicJob),
        recent: recent.map(publicJob),
      };
    },

    /** The newest job for a path: what a file row shows. */
    jobFor(path: string): { id: string; state: Job["state"] } | undefined {
      const r = [...jobs].reverse().find((j) => j.path === path);
      return r ? { id: r.id, state: r.state } : undefined;
    },

    enqueueOne: (path: unknown) => (enqueue([path], false) as Job[])[0],
    enqueueBatch: (paths: unknown) => {
      if (!Array.isArray(paths)) throw new JobError(400, "paths must be a list");
      return enqueue(paths, true) as BatchResponse;
    },
    cancel,
    cancelBatch(batchId: string): Job[] {
      const mine = jobs.filter((j) => j.batchId === batchId && ACTIVE.has(j.state));
      if (!jobs.some((j) => j.batchId === batchId)) throw new JobError(404, "No such batch");
      // Queued ones first, so the running job's end can't start another one in between.
      return mine.sort((a, b) => Number(a.state !== "queued") - Number(b.state !== "queued")).map((j) => {
        try { return cancel(j.id); } catch { return publicJob(j); }
      });
    },

    /** Undo: needs `done` and the file exactly as compressed (B5). */
    async undo(id: string): Promise<Job> {
      const r = get(id);
      if (!r) throw new JobError(404, "No such job");
      if (r.state === "purged") throw new JobError(410, `The original was deleted on ${dayLabel(r.heldUntil ?? r.finishedAt ?? now().toISOString(), opts.tz)}`);
      if (r.state !== "done") throw new JobError(409, "There is nothing to undo");
      try {
        undoSwap(opts.fs, opts.guard, plan(r), r.newIno ?? -1, r.newSize ?? -1);
      } catch (e) {
        if (e instanceof SwapError) throw new JobError(e.status, e.message);
        throw e;
      }
      patch(id, { state: "undone", finishedAt: now().toISOString() });
      void opts.afterChange?.(r).catch(() => undefined);
      return publicJob(r);
    },

    pump,
    /** Shutdown: no new job starts, the running ffmpeg is stopped, its record stays `encoding` for boot recovery. */
    async stop(): Promise<void> {
      closed = true;
      if (running) { opts.kill(running.id, "shutdown"); await running.done; }
    },
  };
}

export type Queue = ReturnType<typeof createQueue>;

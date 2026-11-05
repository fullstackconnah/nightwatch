// Runs one job: re-probe (M4), disk guard, encode, verify, swap, tell Jellyfin (PLAN B3-B7).
import { spawn, type ChildProcess } from "node:child_process";
import { lstatSync } from "node:fs";
import { basename } from "node:path";
import { enoughFor, freeBytes, type Dirs, type Statfs } from "./disk.ts";
import { encodeArgs, streamInfos } from "./encode-args.ts";
import type { Guard } from "./fsguard.ts";
import type { JobRecord, Queue } from "./jobs.ts";
import { NICE, ffprobeJson, parseProbe } from "./probe.ts";
import { DISK_ABORT_BYTES, HOLD_DAYS, type Thresholds } from "./sweet-spot.ts";
import { recoverSwap, rmQuiet, SwapError, swapIn, type SwapFs } from "./swap.ts";
import type { Job } from "./types.ts";
import { verdict } from "./verdict.ts";
import { verifyOutput } from "./verify.ts";

/** One `-progress` block (`key=value` lines up to `progress=`) to the numbers the page shows. */
export function parseProgress(block: string, durationSec: number | null): NonNullable<Job["progress"]> | null {
  const kv: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const us = Number(kv.out_time_us);
  if (!Number.isFinite(us) || us < 0 || !durationSec) return null;
  const speed = Number.parseFloat(kv.speed ?? "");
  const fps = Number(kv.fps);
  const left = Math.max(0, durationSec - us / 1e6);
  return {
    pct: Math.min(100, Math.round((us / 1e6 / durationSec) * 1000) / 10),
    fps: Number.isFinite(fps) && fps > 0 ? Math.round(fps * 10) / 10 : null,
    etaSec: speed > 0 ? Math.round(left / speed) : null,
  };
}

export interface RunnerOpts {
  dirs: Dirs;
  guard: Guard;
  fs: SwapFs;
  statfs: Statfs;
  mediaRoot: string;
  th: Thresholds;
  prefix?: string[];
  graceMs?: number;
  now?: () => Date;
  log?: (line: string) => void;
  /** After a swap: tell Jellyfin and re-probe. Returns the Jellyfin outcome. */
  afterSwap?: (rec: JobRecord) => Promise<Job["jellyfin"]>;
}

export function createRunner(o: RunnerOpts) {
  const now = o.now ?? (() => new Date());
  const procs = new Map<string, ChildProcess>();
  let q: Queue;
  let stopping = false;

  const signal = (id: string, sig: NodeJS.Signals) => {
    const c = procs.get(id);
    if (!c?.pid) return;
    try { process.kill(-c.pid, sig); } catch { c.kill(sig); }
  };
  const track = (id: string) => (c: ChildProcess) => { procs.set(id, c); c.once("close", () => procs.delete(id)); };

  const fail = (rec: JobRecord, check: NonNullable<Job["failedCheck"]>, extra: Partial<JobRecord> = {}) =>
    q.patch(rec.id, { state: "failed", failedCheck: check, finishedAt: now().toISOString(), ...extra });
  const cleanPart = (rec: JobRecord) => rmQuiet(o.guard, o.dirs.work, q.plan(rec).part);

  async function run(rec: JobRecord): Promise<void> {
    const id = rec.id;
    const prefix = o.prefix ?? NICE;
    const t0 = now().toISOString();

    // M4: the verdict at enqueue is stale by now. Re-probe, re-judge, and take the identity of the source from here.
    let json: unknown;
    let st;
    try {
      st = lstatSync(rec.abs);
      json = await ffprobeJson(rec.abs, { prefix });
    } catch {
      return void fail(rec, "source-changed", { startedAt: t0, error: "The source file can't be read" });
    }
    const input = parseProbe(json, { path: rec.path, name: basename(rec.abs), bytes: st.size, mtimeMs: st.mtimeMs, nlink: st.nlink });
    const v = verdict(input, rec.path.startsWith("movies/") ? "film" : "tv", o.th);
    if (v.kind !== "compress") return void fail(rec, "source-changed", { startedAt: t0, error: v.reason });
    if (!enoughFor(o.statfs, o.mediaRoot, st.size)) return void fail(rec, "disk", { startedAt: t0 });

    q.patch(id, {
      state: "encoding", startedAt: t0, crf: v.crf, sourceBytes: st.size, srcIno: st.ino, srcSize: st.size,
      srcMtimeMs: st.mtimeMs, srcMode: st.mode, progress: { pct: 0, fps: null, etaSec: null },
    });
    const plan = q.plan(q.get(id) as JobRecord);

    // Encode.
    const argv = encodeArgs({ src: rec.abs, out: plan.part, container: input.container, streams: streamInfos(json), crf: v.crf, prefix });
    const child = spawn(argv[0], argv.slice(1), { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    track(id)(child);
    let buf = "";
    let errText = "";
    let diskAbort = false;
    child.stdout.on("data", (d: Buffer) => {
      buf += d;
      let i;
      while ((i = buf.search(/progress=\w+\n/)) >= 0) {
        const end = buf.indexOf("\n", i) + 1;
        const p = parseProgress(buf.slice(0, end), input.durationSec);
        buf = buf.slice(end);
        if (p) q.patch(id, { progress: p });
        if (freeBytes(o.statfs, o.mediaRoot) < DISK_ABORT_BYTES && !diskAbort) { diskAbort = true; signal(id, "SIGTERM"); }
      }
    });
    child.stderr.on("data", (d: Buffer) => { if (errText.length < 4000) errText += d; });
    const code = await new Promise<number | null>((res) => { child.on("close", res); child.on("error", () => res(-1)); });

    if (stopping) return; // shutdown: the record stays `encoding`, boot recovery re-queues it
    if (q.isCancelRequested(id)) { cleanPart(rec); return void q.patch(id, { state: "cancelled", finishedAt: now().toISOString(), progress: undefined }); }
    if (diskAbort || /No space left/i.test(errText)) { cleanPart(rec); return void fail(rec, "disk"); }
    if (code !== 0) {
      cleanPart(rec);
      o.log?.(`encoder stopped for ${id}: ${errText.split("\n")[0]?.slice(0, 120)}`);
      return void fail(rec, "encoder");
    }

    // Verify.
    q.patch(id, { state: "verifying", progress: undefined });
    const res = await verifyOutput({ src: rec.abs, out: plan.part, srcBytes: st.size, th: o.th, prefix, onChild: track(id) });
    if (stopping) return;
    if (q.isCancelRequested(id)) { cleanPart(rec); return void q.patch(id, { state: "cancelled", finishedAt: now().toISOString() }); }
    if (!res.ok) {
      cleanPart(rec);
      return void fail(rec, res.check, { ...(res.value === undefined ? {} : { failedValue: res.value }), error: res.message });
    }

    // N10: the last point a cancel can still stop the job.
    if (q.isCancelRequested(id)) { cleanPart(rec); return void q.patch(id, { state: "cancelled", finishedAt: now().toISOString() }); }

    // Swap.
    q.patch(id, { state: "swapping", outputBytes: res.outBytes });
    try {
      const r = swapIn(o.fs, o.guard, plan, (outIno, outSize) => { q.patch(id, { outIno, outputBytes: outSize }); });
      q.patch(id, {
        state: "done", newIno: r.newIno, newSize: r.newSize, outputBytes: r.newSize, finishedAt: now().toISOString(),
        heldUntil: new Date(now().getTime() + HOLD_DAYS * 86_400_000).toISOString(),
      });
    } catch (e) {
      if (e instanceof SwapError && e.check === "source-changed") {
        cleanPart(rec);
        return void fail(rec, "source-changed", { error: e.message });
      }
      const got = recoverSwap(o.fs, o.guard, plan, q.get(id)?.outIno ?? -1);
      if (got.result === "done") {
        q.patch(id, {
          state: "done", newIno: got.newIno, newSize: got.newSize, outputBytes: got.newSize, finishedAt: now().toISOString(),
          heldUntil: new Date(now().getTime() + HOLD_DAYS * 86_400_000).toISOString(),
        });
      } else {
        return void fail(rec, "swap", { error: got.message, keepHold: got.keepHold });
      }
    }
    if (o.afterSwap) q.patch(id, { jellyfin: await o.afterSwap(q.get(id) as JobRecord) });
  }

  return {
    run,
    bind(queue: Queue) { q = queue; },
    /** Cancel or shutdown: SIGTERM to the process group, SIGKILL after the grace period. */
    kill(id: string, why: "cancel" | "shutdown"): void {
      if (why === "shutdown") stopping = true;
      signal(id, "SIGTERM");
      setTimeout(() => signal(id, "SIGKILL"), o.graceMs ?? 10_000).unref();
    },
  };
}

export type Runner = ReturnType<typeof createRunner>;

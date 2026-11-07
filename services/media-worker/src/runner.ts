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
import { resolveMediaPath } from "./paths.ts";
import type { Job } from "./types.ts";
import { verdict } from "./verdict.ts";
import { verifyOutput } from "./verify.ts";

/** Source video frame rate from the probe JSON (first non-cover-art video stream), or null. */
export function srcFpsOf(json: unknown): number | null {
  const streams = (json as { streams?: Array<Record<string, unknown>> } | null)?.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && !(s.disposition as { attached_pic?: number } | undefined)?.attached_pic);
  for (const r of [v?.avg_frame_rate, v?.r_frame_rate]) {
    const [n, d] = String(r ?? "").split("/").map(Number);
    const f = n / (d ?? 1);
    if (Number.isFinite(f) && f > 0) return f;
  }
  return null;
}

/** One `-progress` block (`key=value` lines up to `progress=`) to the numbers the page shows. */
export function parseProgress(block: string, durationSec: number | null, srcFps: number | null): NonNullable<Job["progress"]> | null {
  const kv: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const frame = Number(kv.frame);
  const usOk = Number.isFinite(Number(kv.out_time_us)) && Number(kv.out_time_us) >= 0;
  const haveFps = srcFps != null && srcFps > 0;
  // Files with PGS subtitles report out_time_us=N/A; fall back to frames over the source rate.
  const sec = usOk ? Number(kv.out_time_us) / 1e6 : Number.isFinite(frame) && haveFps ? frame / srcFps : null;
  if (sec == null || !durationSec) return null;
  const speed = Number.parseFloat(kv.speed ?? "");
  const fps = Number(kv.fps);
  const left = Math.max(0, durationSec - sec);
  const byFps = Number.isFinite(frame) && fps > 0 && haveFps ? Math.max(0, (durationSec * srcFps - frame) / fps) : null;
  return {
    pct: Math.min(100, Math.round((sec / durationSec) * 1000) / 10),
    fps: Number.isFinite(fps) && fps > 0 ? Math.round(fps * 10) / 10 : null,
    etaSec: speed > 0 ? Math.round(left / speed) : byFps != null ? Math.round(byFps) : null,
  };
}

export interface Seen { frame?: string; us?: string }

/** R2: a block counts as progress only if `frame=` changed (or, with no `frame=`, `out_time_us=` did); the first block always counts. */
export function progressAdvanced(block: string, last: Seen | null): { advanced: boolean; seen: Seen } {
  const val = (k: string) => new RegExp(`^${k}=(.*)$`, "m").exec(block)?.[1]?.trim();
  const seen = { frame: val("frame"), us: val("out_time_us") };
  const advanced = last === null || (seen.frame !== undefined ? seen.frame !== last.frame : seen.us !== last.us);
  return { advanced, seen };
}

/** B1: an encode that reports no progress for this long is hung. Not a total-time cap: a long film encodes for hours. */
export const STALL_MS = 10 * 60_000;

/** Calls `onStall` once if `kick()` isn't called within `ms`; `clear()` disarms it. */
export function stallWatch(ms: number, onStall: () => void) {
  let t = setTimeout(onStall, ms);
  return {
    kick() { clearTimeout(t); t = setTimeout(onStall, ms); },
    clear() { clearTimeout(t); },
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
  /** Test seam: the no-progress window before a hung encode is killed (default STALL_MS). */
  stallMs?: number;
  /** Test seam: the re-probe at job start. */
  probe?: typeof ffprobeJson;
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
  // B3: only the child that is still the tracked one untracks itself, so a second child isn't dropped by the first one's close.
  const track = (id: string) => (c: ChildProcess) => { procs.set(id, c); c.once("close", () => { if (procs.get(id) === c) procs.delete(id); }); };
  /** SIGTERM to the process group, SIGKILL after the grace period. */
  const terminate = (id: string) => {
    signal(id, "SIGTERM");
    setTimeout(() => signal(id, "SIGKILL"), o.graceMs ?? 10_000).unref();
  };

  const fail = (rec: JobRecord, check: NonNullable<Job["failedCheck"]>, extra: Partial<JobRecord> = {}) =>
    q.get(rec.id)?.state === "cancelled" ? undefined : q.patch(rec.id, { state: "failed", failedCheck: check, finishedAt: now().toISOString(), ...extra });
  /** S6: the path rule, re-run at job start and at the swap: same file, no symlink in the chain. */
  const pathOk = (rec: JobRecord) => {
    const r = resolveMediaPath(rec.path, o.mediaRoot);
    return !("error" in r) && r.abs.replaceAll("\\", "/") === rec.abs.replaceAll("\\", "/"); // Windows dev boxes mix separators
  };
  const cleanPart = (rec: JobRecord) => rmQuiet(o.guard, o.dirs.work, q.plan(rec).part);

  async function run(rec: JobRecord): Promise<void> {
    const id = rec.id;
    const prefix = o.prefix ?? NICE;
    const t0 = now().toISOString();

    // M4: the verdict at enqueue is stale by now. Re-probe, re-judge, and take the identity of the source from here.
    let json: unknown;
    let st;
    try {
      if (!pathOk(rec)) throw new Error("path rule");
      st = lstatSync(rec.abs);
      json = await (o.probe ?? ffprobeJson)(rec.abs, { prefix });
    } catch {
      return void fail(rec, "source-changed", { startedAt: t0, error: "The source file can't be read" });
    }
    const input = parseProbe(json, { path: rec.path, name: basename(rec.abs), bytes: st.size, mtimeMs: st.mtimeMs, nlink: st.nlink });
    const v = verdict(input, rec.path.startsWith("movies/") ? "film" : "tv", o.th);
    if (v.kind !== "compress") return void fail(rec, "source-changed", { startedAt: t0, error: v.reason });
    if (!enoughFor(o.statfs, o.mediaRoot, st.size)) return void fail(rec, "disk", { startedAt: t0 });

    // H1: a cancel can land while the re-probe above is awaited; do not overwrite it with `encoding`.
    if (stopping || q.get(id)?.state !== "queued") return; // shutdown: stays `queued`, runs on the next boot
    q.patch(id, {
      state: "encoding", startedAt: t0, crf: v.crf, sourceBytes: st.size, srcIno: st.ino, srcSize: st.size,
      srcMtimeMs: st.mtimeMs, srcMode: st.mode, progress: { pct: 0, fps: null, etaSec: null },
    });
    const plan = q.plan(q.get(id) as JobRecord);

    // Encode.
    const argv = encodeArgs({ src: rec.abs, out: plan.part, container: input.container, streams: streamInfos(json), crf: v.crf, tune: v.tune, prefix });
    const child = spawn(argv[0], argv.slice(1), { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    track(id)(child);
    const srcFps = srcFpsOf(json);
    let buf = "";
    let errText = "";
    let diskAbort = false;
    let progressWarned = false;
    let stalled = false;
    let lastSeen: Seen | null = null;
    const stall = stallWatch(o.stallMs ?? STALL_MS, () => {
      stalled = true;
      o.log?.(`encoder for ${id} made no progress for ${Math.round((o.stallMs ?? STALL_MS) / 1000)} s; killing it`);
      terminate(id);
    });
    child.stdout.on("data", (d: Buffer) => {
      buf += d;
      let i;
      while ((i = buf.search(/progress=\w+\n/)) >= 0) {
        const end = buf.indexOf("\n", i) + 1;
        const adv = progressAdvanced(buf.slice(0, end), lastSeen);
        lastSeen = adv.seen;
        if (adv.advanced) stall.kick();
        const p = parseProgress(buf.slice(0, end), input.durationSec, srcFps);
        buf = buf.slice(end);
        if (p) {
          // H4: progress is advisory; a full or read-only state volume must not kill the worker.
          try { q.patch(id, { progress: p }); } catch (e) { if (!progressWarned) { progressWarned = true; o.log?.(`progress for ${id} not saved: ${(e as Error).message}`); } }
        }
        if (freeBytes(o.statfs, o.mediaRoot) < DISK_ABORT_BYTES && !diskAbort) { diskAbort = true; signal(id, "SIGTERM"); }
      }
    });
    child.stderr.on("data", (d: Buffer) => { if (errText.length < 4000) errText += d; });
    const code = await new Promise<number | null>((res) => { child.on("close", res); child.on("error", () => res(-1)); });
    stall.clear();

    if (stopping) return; // shutdown: the record stays `encoding`, boot recovery re-queues it
    if (q.isCancelRequested(id)) { cleanPart(rec); return void q.patch(id, { state: "cancelled", finishedAt: now().toISOString(), progress: undefined }); }
    if (diskAbort || /No space left/i.test(errText)) { cleanPart(rec); return void fail(rec, "disk"); }
    if (code !== 0) {
      cleanPart(rec);
      o.log?.(`encoder stopped for ${id}${stalled ? " (stalled)" : ""}: ${errText.split("\n")[0]?.slice(0, 120)}`);
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
      const r = swapIn(o.fs, o.guard, plan, (outIno, outSize) => { q.patch(id, { outIno, outputBytes: outSize }); }, () => pathOk(rec));
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
    track, // exposed for the B3 test
    bind(queue: Queue) { q = queue; },
    /** Cancel or shutdown: SIGTERM to the process group, SIGKILL after the grace period. */
    kill(id: string, why: "cancel" | "shutdown"): void {
      if (why === "shutdown") stopping = true;
      terminate(id);
    },
  };
}

export type Runner = ReturnType<typeof createRunner>;

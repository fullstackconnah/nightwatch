// Verify the new file before the swap (PLAN B4, with M4, N3, N10). Five checks, in order; the first failure wins.
import { spawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import { NICE } from "./probe.ts";
import { MIN_SAVING_PCT, type Thresholds } from "./sweet-spot.ts";
import type { Job } from "./types.ts";

export type Check = NonNullable<Job["failedCheck"]>;
export type VerifyResult =
  | { ok: true; outBytes: number }
  | { ok: false; check: Check; value?: number; message: string };

export interface Proc { code: number | null; stdout: string; stderr: string }

/** B1: one verify child (ffprobe, or an ffmpeg decode) that runs longer than this is hung. */
export const VERIFY_CHILD_MS = 15 * 60_000;

/** R1: a full-file decode or packet count may take up to twice the film's length; a missing duration keeps the flat cap. */
export const fullReadMs = (durSec?: number): number => Math.max(VERIFY_CHILD_MS, (durSec || 0) * 2000);

/** Runs argv in its own process group (so Cancel can kill the whole group); `onChild` lets the caller track it.
 *  Past `timeoutMs` the group is SIGKILLed and the result is code -1, which verify reports as a failed check. */
export function execProc(argv: string[], onChild?: (c: ChildProcess) => void, timeoutMs = VERIFY_CHILD_MS): Promise<Proc> {
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    const c = spawn(cmd, args, { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    onChild?.(c);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { process.kill(-(c.pid as number), "SIGKILL"); } catch { c.kill("SIGKILL"); }
      resolve({ code: -1, stdout, stderr: "timed out" }); // a child stuck in the kernel may never close
    }, timeoutMs);
    c.stdout.on("data", (d: Buffer) => { if (stdout.length < 16 * 1024 * 1024) stdout += d; });
    c.stderr.on("data", (d: Buffer) => { if (stderr.length < 64 * 1024) stderr += d; });
    c.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: e.message }); });
    c.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

interface Stream {
  index: number; codec_type?: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string;
  avg_frame_rate?: string; disposition?: { attached_pic?: number }; tags?: { language?: string };
}
interface Full { format?: { duration?: string }; streams?: Stream[]; chapters?: unknown[] }

const rate = (r?: string): number => {
  const [n, d] = (r ?? "0/1").split("/").map(Number);
  return d ? n / d : 0;
};

const lang = (s: Stream) => s.tags?.language ?? "und";

function summary(j: Full) {
  const streams = j.streams ?? [];
  const pic = (s: Stream) => Boolean(s.disposition?.attached_pic);
  return {
    dur: Number(j.format?.duration) || 0,
    main: streams.filter((s) => s.codec_type === "video" && !pic(s)),
    audio: streams.filter((s) => s.codec_type === "audio").map(lang),
    subs: streams.filter((s) => s.codec_type === "subtitle").map(lang),
    pics: streams.filter((s) => s.codec_type === "video" && pic(s)).length,
    attachments: streams.filter((s) => s.codec_type === "attachment").length,
    chapters: (j.chapters ?? []).length,
  };
}

export interface VerifyOpts {
  src: string;
  out: string;
  srcBytes: number;
  th: Thresholds;
  prefix?: string[];
  onChild?: (c: ChildProcess) => void;
}

export async function verifyOutput(o: VerifyOpts): Promise<VerifyResult> {
  const pre = o.prefix ?? NICE;
  const fail = (check: Check, message: string, value?: number): VerifyResult => ({ ok: false, check, message, ...(value === undefined ? {} : { value }) });
  const run = (argv: string[], ms?: number) => execProc([...pre, ...argv], o.onChild, ms);
  const probe = async (file: string): Promise<Full | null> => {
    const r = await run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", file]);
    if (r.code !== 0) return null;
    try { return JSON.parse(r.stdout) as Full; } catch { return null; }
  };
  let fullMs = VERIFY_CHILD_MS; // set once the duration is known; the full-file reads use it
  const packets = async (file: string, idx: number): Promise<number | null> => {
    const r = await run(["ffprobe", "-v", "error", "-count_packets", "-select_streams", String(idx), "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file], fullMs);
    const n = Number(r.stdout.trim().split(/\s+/)[0]);
    return r.code === 0 && Number.isFinite(n) ? n : null;
  };

  // 1. probe and saving
  let outBytes = 0;
  try { outBytes = statSync(o.out).size; } catch { /* missing */ }
  const [sj, oj] = await Promise.all([probe(o.src), outBytes > 0 ? probe(o.out) : null]);
  if (!sj || !oj) return fail("probe", "The new file couldn't be read");
  const saved = o.srcBytes - outBytes;
  if (saved / o.srcBytes < MIN_SAVING_PCT) {
    const pct = Math.max(0, Math.round((saved / o.srcBytes) * 100));
    return fail("saving", `Saved only ${pct}%`, pct);
  }
  if (saved < o.th.MIN_SAVING_BYTES) {
    return fail("small-saving", `Saved only ${Math.round(saved / 1048576)} MB, too little to keep`, Math.max(0, saved));
  }

  // 2. duration
  const s = summary(sj);
  const t = summary(oj);
  fullMs = fullReadMs(s.dur);
  const diff = Math.abs(s.dur - t.dur);
  if (diff > Math.max(1.0, s.dur * 0.001)) return fail("duration", `The new file is ${Math.round(diff)} s ${t.dur < s.dur ? "shorter" : "longer"}`, Math.round(diff));

  // 3. streams
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const sv = s.main[0];
  const tv = t.main[0];
  const bad =
    !same(s.audio, t.audio) || !same(s.subs, t.subs) || s.chapters !== t.chapters || s.pics !== t.pics || s.attachments !== t.attachments ||
    t.main.length !== 1 || !tv || tv.codec_name !== "hevc" || tv.pix_fmt !== "yuv420p" || !sv ||
    sv.width !== tv.width || sv.height !== tv.height || Math.abs(rate(sv.avg_frame_rate) - rate(tv.avg_frame_rate)) > 0.01;
  if (bad) return fail("streams", "A track went missing or changed");

  // 4. decode (the main video by index, since cover art can come first, then every audio track)
  const dv = await run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", o.out, "-map", `0:${tv.index}`, "-f", "null", "-"], fullMs);
  const da = await run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", o.out, "-map", "0:a?", "-f", "null", "-"], fullMs);
  if (dv.code !== 0 || dv.stderr.trim() || da.code !== 0 || da.stderr.trim()) return fail("decode", "The new file has decode errors");

  // 5. frames
  const [ps, pt] = await Promise.all([packets(o.src, sv.index), packets(o.out, tv.index)]);
  if (ps === null || pt === null || Math.abs(ps - pt) > 1) return fail("frames", "The frame count changed");

  return { ok: true, outBytes };
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { makeClip } from "./clips.ts";
import { checkReady } from "./disk.ts";
import { createGuard } from "./fsguard.ts";
import { createQueue, type JobRecord } from "./jobs.ts";
import { ffprobeJson } from "./probe.ts";
import { createRunner, parseProgress } from "./runner.ts";
import { realFs } from "./swap.ts";
import { needFfmpeg, tempDir } from "./testkit.ts";

const GB = 2 ** 30;
const TH = { MIN_FILE_BYTES: 0, MIN_SAVING_BYTES: 0 };
const NOW = new Date("2026-11-05T00:00:00Z");
const PLENTY = () => ({ bavail: (500 * GB) / 4096, bsize: 4096 });

let root: string;
let clips: string;
let ready = true;
let n = 0;

before((t) => {
  root = tempDir("mw-run-");
  for (const d of ["movies", "tv", ".nightwatch"]) mkdirSync(join(root, d));
  clips = tempDir("mw-clips-");
  // resolveMediaPath (the S6 re-check at job start) needs POSIX paths, so the end-to-end flow runs on Linux only.
  if (process.platform !== "linux" || !needFfmpeg(t)) { ready = false; return; }
  makeClip(join(clips, "film.mkv"), { kind: "mkv", tagBps: true });
  makeClip(join(clips, "film.mp4"), { kind: "mp4" });
  makeClip(join(clips, "hdr.mkv"), { kind: "mkv", hdr: true });
  makeClip(join(clips, "long.mkv"), { kind: "mkv", seconds: 30 });
});
after(() => { rmSync(root, { recursive: true, force: true }); rmSync(clips, { recursive: true, force: true }); });

/** A queue and runner over a fresh media root (no scanner, no http): the unit under test is `runner.run`. */
function world(over: { statfs?: () => { bavail: number; bsize: number }; jellyfin?: "told" | "failed" | "off"; probe?: typeof ffprobeJson; log?: (l: string) => void } = {}) {
  const dirs = checkReady(root).dirs;
  const guard = createGuard(dirs);
  const stateDir = tempDir("mw-run-state-");
  const runner = createRunner({
    dirs, guard, fs: realFs, statfs: over.statfs ?? PLENTY, mediaRoot: root, th: TH, prefix: [], graceMs: 300, now: () => NOW, ...(over.probe ? { probe: over.probe } : {}), ...(over.log ? { log: over.log } : {}),
    afterSwap: async () => over.jellyfin ?? "off",
  });
  const q = createQueue({
    stateDir, mediaRoot: root, dirs, guard, fs: realFs, statfs: PLENTY, enabled: true, ready: () => ({ ready: true }),
    lookup: () => undefined, uid: undefined, run: (r) => runner.run(r), kill: (id, why) => runner.kill(id, why), now: () => NOW,
  });
  runner.bind(q);
  const put = (clip: string, ext: string): JobRecord => {
    const id = `run${++n}`;
    const rel = `movies/Film ${id} (2000)/Film.${ext}`;
    mkdirSync(join(root, "movies", `Film ${id} (2000)`), { recursive: true });
    copyFileSync(join(clips, clip), join(root, rel));
    const rec = { id, path: rel, state: "queued", createdAt: "x", crf: 21, sourceBytes: 1, attempts: 0, abs: join(root, rel), container: "matroska" } as JobRecord;
    q.all().push(rec);
    q.patch(id, {});
    return rec;
  };
  return { q, runner, dirs, put };
}

describe("parseProgress (B3)", () => {
  it("42.0% from a sample block, with fps and an eta from speed", () => {
    const block = "frame=250\nfps=25.0\nout_time_us=42000000\nspeed=2.0x\nprogress=continue\n";
    assert.deepEqual(parseProgress(block, 100, 24), { pct: 42, fps: 25, etaSec: 29 });
  });

  it("out_time_us=N/A: falls back to frame / source fps; null without a source fps", () => {
    const block = "frame=2400\nfps=30\nout_time_us=N/A\nspeed=N/A\nprogress=continue\n";
    assert.deepEqual(parseProgress(block, 1000, 24), { pct: 10, fps: 30, etaSec: 720 });
    assert.equal(parseProgress(block, 1000, null), null);
  });
});

describe("runner end to end (B3-B5, S2, S7, M4)", () => {
  const skip = () => !ready;

  it("mkv: encodes, verifies, swaps; the path is HEVC, the original is held, the stale BPS tag is gone (S2)", async (t) => {
    if (skip()) return t.skip("no ffmpeg");
    const w = world({ jellyfin: "told" });
    const rec = w.put("film.mkv", "mkv");
    const before = statSync(rec.abs).size;
    await w.runner.run(rec);
    const r = w.q.get(rec.id) as JobRecord;
    assert.equal(r.state, "done", JSON.stringify(r));
    assert.equal(r.jellyfin, "told");
    assert.equal(r.heldUntil, "2026-11-12T00:00:00.000Z");
    const json = (await ffprobeJson(rec.abs, { prefix: [] })) as { streams: { codec_name: string; tags?: Record<string, string> }[] };
    const video = json.streams.find((s) => s.codec_name === "hevc");
    assert.ok(video, "the path holds an HEVC stream");
    assert.equal(video.tags?.BPS, undefined);
    assert.equal(statSync(join(w.dirs.hold, rec.id, "Film.mkv")).size, before);
    assert.deepEqual(readdirSync(w.dirs.work), []);
  });

  it("H1: a cancel that lands during the re-probe stays cancelled; nothing is encoded or swapped", async (t) => {
    if (skip()) return t.skip("no ffmpeg");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const w = world({ probe: async (abs, o) => { await gate; return ffprobeJson(abs, o); } });
    const rec = w.put("film.mkv", "mkv");
    const before = statSync(rec.abs).size;
    const running = w.runner.run(rec);
    w.q.cancel(rec.id); // the record is still `queued`, so this is the no-kill path
    release();
    await running;
    const r = w.q.get(rec.id) as JobRecord;
    assert.equal(r.state, "cancelled", JSON.stringify(r));
    assert.equal(r.startedAt, undefined);
    assert.equal(statSync(rec.abs).size, before);
    assert.deepEqual(readdirSync(w.dirs.work), []);
    assert.equal(existsSync(join(w.dirs.hold, rec.id)), false);
  });

  it("R2: a shutdown during the re-probe spawns no encode and the record stays queued", async (t) => {
    if (skip()) return t.skip("no ffmpeg");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const w = world({ probe: async (abs, o) => { await gate; return ffprobeJson(abs, o); } });
    const rec = w.put("film.mkv", "mkv");
    const running = w.runner.run(rec);
    w.runner.kill(rec.id, "shutdown");
    release();
    await running;
    const r = w.q.get(rec.id) as JobRecord;
    assert.equal(r.state, "queued", JSON.stringify(r));
    assert.deepEqual(readdirSync(w.dirs.work), []);
  });

  it("R3: a cancel during the re-probe then a probe error stays cancelled, not failed", async (t) => {
    if (skip()) return t.skip("no ffmpeg");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const w = world({ probe: async () => { await gate; throw new Error("probe died"); } });
    const rec = w.put("film.mkv", "mkv");
    const running = w.runner.run(rec);
    w.q.cancel(rec.id);
    release();
    await running;
    assert.equal(w.q.get(rec.id)?.state, "cancelled");
  });

  it("H4: a progress patch that throws is logged once and the job still finishes", async (t) => {
    if (skip()) return t.skip("no ffmpeg");
    const logs: string[] = [];
    const w = world({ log: (l) => logs.push(l) });
    const rec = w.put("film.mkv", "mkv");
    const real = w.q.patch;
    w.q.patch = (id, p) => {
      if (p.progress && Object.keys(p).length === 1) throw new Error("ENOSPC");
      return real(id, p);
    };
    await w.runner.run(rec);
    assert.equal((w.q.get(rec.id) as JobRecord).state, "done");
    const warned = logs.filter((l) => /progress for .* not saved/.test(l));
    assert.equal(warned.length, 1, logs.join("|"));
  });

  it("mp4: the same flow, and the output carries the hvc1 tag (S7)", async (t) => {
    if (skip()) return t.skip("no ffmpeg");
    const w = world();
    const rec = w.put("film.mp4", "mp4");
    w.q.patch(rec.id, { container: "mov" });
    await w.runner.run(rec);
    assert.equal(w.q.get(rec.id)?.state, "done", JSON.stringify(w.q.get(rec.id)));
    const tag = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,codec_tag_string", "-of", "csv=p=0", rec.abs]).toString().trim();
    assert.equal(tag, "hevc,hvc1");
  });

  it("M4: a source replaced by an HDR file before the job starts fails 'source-changed' and encodes nothing", async (t) => {
    if (skip()) return t.skip("no ffmpeg");
    const w = world();
    const rec = w.put("film.mkv", "mkv");
    copyFileSync(join(clips, "hdr.mkv"), rec.abs);
    await w.runner.run(rec);
    const r = w.q.get(rec.id) as JobRecord;
    assert.equal(r.state, "failed");
    assert.equal(r.failedCheck, "source-changed");
    assert.equal(r.error, "HDR10");
    assert.deepEqual(readdirSync(w.dirs.work), []);
    assert.equal(existsSync(join(w.dirs.hold, rec.id)), false);
  });

  it("B6: free space under the abort floor kills the encode, removes the .part and fails 'disk'", async (t) => {
    if (skip()) return t.skip("no ffmpeg");
    let calls = 0;
    // The start guard passes; every later check (the progress ticks) sees almost nothing free.
    const w = world({ statfs: () => (++calls <= 2 ? { bavail: (500 * GB) / 4096, bsize: 4096 } : { bavail: 10, bsize: 4096 }) });
    const rec = w.put("long.mkv", "mkv");
    await w.runner.run(rec);
    assert.equal(w.q.get(rec.id)?.state, "failed");
    assert.equal(w.q.get(rec.id)?.failedCheck, "disk");
    assert.deepEqual(readdirSync(w.dirs.work), []);
    assert.equal(statSync(rec.abs).size > 0, true);
  });

  it("B3: Cancel kills the encode, removes the .part and leaves the original in place", async (t) => {
    if (skip()) return t.skip("no ffmpeg");
    const w = world();
    const rec = w.put("long.mkv", "mkv");
    const before = statSync(rec.abs).size;
    const done = w.runner.run(rec);
    for (let i = 0; i < 100 && w.q.get(rec.id)?.state !== "encoding"; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 500));
    w.q.cancel(rec.id);
    await done;
    assert.equal(w.q.get(rec.id)?.state, "cancelled");
    assert.deepEqual(readdirSync(w.dirs.work), []);
    assert.equal(statSync(rec.abs).size, before);
  });
});

void writeFileSync;

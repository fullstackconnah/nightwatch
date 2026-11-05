import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { makeClip } from "./clips.ts";
import { encodeArgs, streamInfos, type StreamInfo } from "./encode-args.ts";
import { ffprobeJson } from "./probe.ts";
import { needFfmpeg, tempDir } from "./testkit.ts";
import { verifyOutput, type VerifyResult } from "./verify.ts";

const TH = { MIN_FILE_BYTES: 0, MIN_SAVING_BYTES: 0 };
let dir: string;
let src: string;
let streams: StreamInfo[];

/** Encodes src with encodeArgs (CRF 30 to keep it quick); `extra` goes just before the output path. */
function encode(out: string, o: { streams?: StreamInfo[]; extra?: string[] } = {}): void {
  const a = encodeArgs({ src, out, container: "matroska", streams: o.streams ?? streams, crf: 30, prefix: [] });
  a.splice(a.length - 1, 0, ...(o.extra ?? []));
  // Quiet, fast: the point is the verify result, not the encoder's speed.
  a.splice(a.indexOf("-preset") + 1, 1, "ultrafast");
  execFileSync(a[0], a.slice(1), { stdio: "pipe" });
}

const check = (out: string): Promise<VerifyResult> =>
  verifyOutput({ src, out, srcBytes: statSync(src).size, th: TH, prefix: [] });

describe("verify (B4)", () => {
  let skipped = false;
  before(async (t) => {
    dir = tempDir("mw-verify-");
    if (!needFfmpeg(t)) { skipped = true; return; }
    src = join(dir, "src.mkv");
    makeClip(src, { kind: "mkv" });
    streams = streamInfos(await ffprobeJson(src, { prefix: [] }));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("a good encode passes all five checks", async (t) => {
    if (skipped) return t.skip("no ffmpeg");
    const out = join(dir, "good.mkv");
    encode(out);
    const r = await check(out);
    assert.deepEqual(r.ok, true, JSON.stringify(r));
  });

  it("an output cut with -t 2 fails 'duration'", async (t) => {
    if (skipped) return t.skip("no ffmpeg");
    const out = join(dir, "cut.mkv");
    encode(out, { extra: ["-t", "2"] });
    const r = await check(out);
    assert.equal(r.ok === false && r.check, "duration");
  });

  it("an output that drops the subtitle fails 'streams'", async (t) => {
    if (skipped) return t.skip("no ffmpeg");
    const out = join(dir, "nosub.mkv");
    encode(out, { streams: streams.filter((s) => s.type !== "subtitle") });
    const r = await check(out);
    assert.equal(r.ok === false && r.check, "streams");
  });

  it("a 1280x720 source re-encoded at 640x360 fails 'streams'", async (t) => {
    if (skipped) return t.skip("no ffmpeg");
    const out = join(dir, "small.mkv");
    encode(out, { extra: ["-vf", "scale=640:360"] });
    const r = await check(out);
    assert.equal(r.ok === false && r.check, "streams");
  });

  it("an output truncated to half its bytes fails (probe, duration or decode): the original stays either way", async (t) => {
    if (skipped) return t.skip("no ffmpeg");
    const good = join(dir, "good.mkv");
    const out = join(dir, "half.mkv");
    writeFileSync(out, readFileSync(good).subarray(0, Math.floor(statSync(good).size / 2)));
    const r = await check(out);
    assert.equal(r.ok, false);
  });

  it("a percent-pass, bytes-fail saving fails 'small-saving' with the saved bytes", async (t) => {
    if (skipped) return t.skip("no ffmpeg");
    const out = join(dir, "small.mkv");
    encode(out);
    const srcBytes = statSync(src).size;
    const r = await verifyOutput({ src, out, srcBytes, th: { MIN_FILE_BYTES: 0, MIN_SAVING_BYTES: srcBytes }, prefix: [] });
    assert.ok(!r.ok && r.check === "small-saving" && r.value === srcBytes - statSync(out).size, JSON.stringify(r));
  });

  it("a missing output fails 'probe'; a no-saving output fails 'saving'", async (t) => {
    if (skipped) return t.skip("no ffmpeg");
    const gone = await check(join(dir, "nope.mkv"));
    assert.equal(gone.ok === false && gone.check, "probe");
    const copy = join(dir, "copy.mkv");
    copyFileSync(src, copy);
    const r = await check(copy);
    assert.equal(r.ok === false && r.check === "saving" && r.value, 0);
  });
});

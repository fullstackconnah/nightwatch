import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { thresholds } from "./sweet-spot.ts";
import type { Res } from "./types.ts";
import { verdict, type VerdictInput } from "./verdict.ts";

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const reason = (v: { reason: string }) => v.reason;

function mk(over: {
  bytes?: number; durationSec?: number | null; container?: string; nlink?: number;
  codec?: string; res?: Res; kbps?: number | null; pixFmtTenBit?: boolean;
  hdr?: "HDR10" | "HLG" | "Dolby Vision" | null; wide?: boolean; interlaced?: boolean;
  subs?: string[]; attachments?: number; videoStreams?: number; probeError?: string; noVideo?: boolean;
} = {}): VerdictInput {
  return {
    path: "movies/A/A.mkv", name: "A.mkv", bytes: over.bytes ?? 8 * GB, mtimeMs: 0, nlink: over.nlink ?? 1,
    durationSec: over.durationSec === undefined ? 7200 : over.durationSec,
    container: over.container ?? "matroska",
    video: over.noVideo ? null : {
      codec: over.codec ?? "h264", profile: null, width: 1920, height: 1080, res: over.res ?? "1080p",
      kbps: over.kbps === undefined ? 8000 : over.kbps, kbpsSource: "stream",
      tenBit: over.pixFmtTenBit ?? false, hdr: over.hdr ?? null, wideColour: over.wide ?? false,
      interlaced: over.interlaced ?? false,
    },
    videoStreams: over.videoStreams ?? 1, attachments: over.attachments ?? 0,
    audio: [], subs: (over.subs ?? []).map((codec) => ({ codec, lang: null })),
    ...(over.probeError ? { probeError: over.probeError } : {}),
  };
}

describe("verdict", () => {
  it("h264 1080p film at 8000 kbps compresses", () => {
    const v = verdict(mk(), "film");
    assert.equal(v.kind, "compress");
    if (v.kind !== "compress") return;
    assert.equal(v.ratio, 2.29);
    assert.equal(v.crf, 21);
    assert.equal(v.targetKbps, 3500);
    assert.ok(v.estSavingBytes > 4e9);
    assert.equal(v.reason, "2.29× the sweet spot for 1080p film");
  });

  it("h264 1080p at 4500 kbps is close to the sweet spot", () => {
    assert.deepEqual(verdict(mk({ kbps: 4500 }), "film"), { kind: "ok", ratio: 1.29, reason: "Close to the sweet spot" });
  });

  it("h264 1080p at 3000 kbps is already under", () => {
    const v = verdict(mk({ kbps: 3000 }), "film");
    assert.equal(v.kind, "ok");
    assert.equal(v.reason, "Already under the sweet spot");
  });

  it("hevc 1080p at 8000 kbps is ok (2.29 < 3)", () => {
    assert.equal(verdict(mk({ codec: "hevc" }), "film").kind, "ok");
  });

  it("hevc 1080p at 12000 kbps compresses with the 10% penalty", () => {
    const h264 = verdict(mk({ kbps: 12000, bytes: 12 * GB }), "film");
    const hevc = verdict(mk({ kbps: 12000, bytes: 12 * GB, codec: "hevc" }), "film");
    assert.ok(h264.kind === "compress" && hevc.kind === "compress");
    if (h264.kind !== "compress" || hevc.kind !== "compress") return;
    assert.ok(Math.abs(hevc.estSavingBytes - h264.estSavingBytes * 0.9) <= 1);
  });

  it("mpeg2video 720p TV at 2000 kbps compresses in Matroska (1.33 >= 1.3)", () => {
    const v = verdict(mk({ codec: "mpeg2video", res: "720p", kbps: 2000, bytes: 3 * GB, durationSec: 10800 }), "tv");
    assert.equal(v.kind, "compress");
  });

  it("an unknown codec is never flagged", () => {
    assert.equal(verdict(mk({ codec: "prores", kbps: 90000 }), "film").kind, "ok");
  });

  it("avi can't hold HEVC", () => {
    assert.deepEqual(verdict(mk({ container: "avi", codec: "mpeg4" }), "film"), { kind: "cant", reason: "AVI can't hold HEVC here" });
  });

  it("mp4 with PGS subtitles can't", () => {
    assert.deepEqual(verdict(mk({ container: "mov", subs: ["hdmv_pgs_subtitle"] }), "film"), {
      kind: "cant", reason: "MP4 can't hold PGS subtitles",
    });
  });

  it("mp4 with mov_text passes the container rule", () => {
    assert.equal(verdict(mk({ container: "mov", subs: ["mov_text"] }), "film").kind, "compress");
  });

  it("mp4 with an attachment stream can't", () => {
    assert.equal(verdict(mk({ container: "mov", attachments: 1 }), "film").kind, "cant");
  });

  it("more than one video track can't (N2)", () => {
    assert.deepEqual(verdict(mk({ videoStreams: 2 }), "film"), { kind: "cant", reason: "More than one video track" });
  });

  it("HDR10, HLG and Dolby Vision skip", () => {
    assert.deepEqual(verdict(mk({ hdr: "HDR10" }), "film"), { kind: "skip", reason: "HDR10" });
    assert.deepEqual(verdict(mk({ hdr: "HLG" }), "film"), { kind: "skip", reason: "HLG" });
    assert.deepEqual(verdict(mk({ hdr: "Dolby Vision" }), "film"), { kind: "skip", reason: "Dolby Vision" });
  });

  it("bt2020 primaries skip (N8)", () => {
    assert.deepEqual(verdict(mk({ wide: true }), "film"), { kind: "skip", reason: "Wide colour (BT.2020)" });
  });

  it("10-bit skips", () => {
    assert.deepEqual(verdict(mk({ pixFmtTenBit: true }), "film"), { kind: "skip", reason: "10-bit" });
  });

  it("interlaced skips", () => {
    assert.deepEqual(verdict(mk({ interlaced: true }), "film"), { kind: "skip", reason: "Interlaced" });
  });

  it("a missing video stream or a probe error is 'Couldn't read this file'", () => {
    assert.deepEqual(verdict(mk({ noVideo: true }), "film"), { kind: "skip", reason: "Couldn't read this file" });
    assert.deepEqual(verdict(mk({ probeError: "boom" }), "film"), { kind: "skip", reason: "Couldn't read this file" });
  });

  it("400 MB is a small file", () => {
    const v = verdict(mk({ bytes: 400 * MB }), "film");
    assert.equal(v.kind, "ok");
    assert.equal(v.kind === "ok" && v.reason, "Small file");
  });

  it("a hardlinked file is 'Shared', ahead of the size rule", () => {
    const v = verdict(mk({ nlink: 2 }), "film");
    assert.equal(v.kind, "ok");
    assert.match(v.kind === "ok" ? v.reason : "", /^Shared with another file/);
    const small = verdict(mk({ nlink: 2, bytes: MB }), "film");
    assert.match(small.kind === "ok" ? small.reason : "", /^Shared with another file/);
  });

  it("judges the sweet spot by the resolution bucket", () => {
    // The sweet spot follows the bucket: a 1080p-bucket file is judged against 3500, not 2000.
    assert.equal(verdict(mk({ res: "1080p", kbps: 6000 }), "film").kind, "compress");
    assert.equal(verdict(mk({ res: "720p", kbps: 6000 }), "film").kind, "compress");
    assert.equal(verdict(mk({ res: "2160p", kbps: 6000 }), "film").kind, "ok");
  });

  it("unknown bitrate is ok", () => {
    assert.deepEqual(verdict(mk({ kbps: null }), "film"), { kind: "ok", ratio: null, reason: "Bitrate unknown" });
  });

  it("a small saving is ok", () => {
    // 6000 kbps video in a file that is mostly other streams: 11% saving.
    const v = verdict(mk({ kbps: 6000, bytes: 10 * GB, durationSec: 3600 }), "film");
    assert.equal(v.kind, "ok");
    assert.equal(v.kind === "ok" && v.reason, "Saving too small");
  });

  it("the test scale lowers the size floor only", () => {
    const small = mk({ bytes: 600, kbps: 1, durationSec: 1 });
    assert.equal(reason(verdict(small, "film", thresholds({}))), "Small file");
    assert.equal(reason(verdict(small, "film", thresholds({ MEDIA_WORKER_TEST_THRESHOLDS: "1" }))), "Already under the sweet spot");
  });

  it("verdict.ts holds no numeric literal over 100 (numbers live in sweet-spot.ts)", () => {
    const src = readFileSync(new URL("./verdict.ts", import.meta.url), "utf8");
    const big = (src.match(/(?<![\w.$])\d+(?:\.\d+)?(?![\w.])/g) ?? []).filter((n) => Number(n) > 100);
    assert.deepEqual(big, []);
  });
});

describe("thresholds", () => {
  const REAL = 500 * MB;
  it("unset and '0' mean the real thresholds (N11)", () => {
    assert.equal(thresholds({}).MIN_FILE_BYTES, REAL);
    assert.equal(thresholds({ MEDIA_WORKER_TEST_THRESHOLDS: "0" }).MIN_FILE_BYTES, REAL);
    assert.equal(thresholds({ MEDIA_WORKER_TEST_THRESHOLDS: "true" }).MIN_SAVING_BYTES, REAL);
  });
  it("'1' scales the two size floors to 500 bytes", () => {
    assert.deepEqual(thresholds({ MEDIA_WORKER_TEST_THRESHOLDS: "1" }), { MIN_FILE_BYTES: 500, MIN_SAVING_BYTES: 500 });
  });
});

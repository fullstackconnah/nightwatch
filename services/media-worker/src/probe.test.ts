import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bucketRes, parseProbe, probeFile, probeReason, type FileStat } from "./probe.ts";
import { needFfmpeg, SKIP_OFF_LINUX, tempDir } from "./testkit.ts";

const data = (name: string) => JSON.parse(readFileSync(new URL(`../test-data/${name}`, import.meta.url), "utf8"));
const st = (over: Partial<FileStat> = {}): FileStat => ({
  path: "movies/A/A.mkv", name: "A.mkv", bytes: 7516192768, mtimeMs: 1, nlink: 1, ...over,
});

describe("parseProbe bitrate order", () => {
  it("takes the stream bit_rate first", () => {
    const f = parseProbe(data("probe-mp4.json"), st({ bytes: 78125000 }));
    assert.equal(f.video?.kbps, 6000);
    assert.equal(f.video?.kbpsSource, "stream");
  });

  it("falls back to the BPS tag", () => {
    const f = parseProbe(data("probe-mkv-tags.json"), st());
    assert.equal(f.video?.kbps, 8000);
    assert.equal(f.video?.kbpsSource, "tag");
  });

  it("then to an estimate: size over duration, less the audio", () => {
    const f = parseProbe(data("probe-avi.json"), st({ bytes: 1500000000, name: "A.avi" }));
    assert.equal(f.video?.kbpsSource, "estimated");
    assert.equal(f.video?.kbps, Math.round((1500000000 * 8) / 5400 / 1000 - 128));
  });

  it("ignores a tag that implies more bytes than the file holds (stale mkvmerge tag)", () => {
    const j = data("probe-mkv-tags.json");
    j.streams[0].tags.BPS = "99999999999";
    const f = parseProbe(j, st());
    assert.equal(f.video?.kbpsSource, "estimated");
  });

  it("is null when nothing gives a bitrate", () => {
    const j = data("probe-avi.json");
    delete j.format.duration;
    const f = parseProbe(j, st());
    assert.equal(f.video?.kbps, null);
    assert.equal(f.video?.kbpsSource, null);
    assert.equal(f.durationSec, null);
  });
});

describe("parseProbe streams", () => {
  it("does not take an attached picture as the main video", () => {
    const f = parseProbe(data("probe-cover.json"), st({ bytes: 400000000 }));
    assert.equal(f.video?.codec, "h264");
    assert.equal(f.video?.res, "1080p");
    assert.equal(f.videoStreams, 1);
    assert.equal(f.attachments, 1);
  });

  it("reads languages from tags.language", () => {
    const f = parseProbe(data("probe-mkv-tags.json"), st());
    assert.deepEqual(f.audio, [
      { codec: "eac3", channels: 6, lang: "eng" },
      { codec: "ac3", channels: 2, lang: "fra" },
    ]);
    assert.deepEqual(f.subs, [{ codec: "subrip", lang: "eng" }]);
  });

  it("takes the first token of format_name, and tells webm apart by extension", () => {
    assert.equal(parseProbe(data("probe-mkv-tags.json"), st()).container, "matroska");
    assert.equal(parseProbe(data("probe-mkv-tags.json"), st({ name: "A.webm" })).container, "webm");
    assert.equal(parseProbe(data("probe-mp4.json"), st()).container, "mov");
    assert.equal(parseProbe(data("probe-avi.json"), st()).container, "avi");
  });

  it("detects HDR10, wide colour and 10-bit", () => {
    const v = parseProbe(data("probe-hdr.json"), st({ bytes: 13500000000 })).video!;
    assert.equal(v.hdr, "HDR10");
    assert.equal(v.wideColour, true);
    assert.equal(v.tenBit, true);
    assert.equal(v.res, "2160p");
  });

  it("detects HLG and Dolby Vision", () => {
    const hlg = data("probe-hdr.json");
    hlg.streams[0].color_transfer = "arib-std-b67";
    assert.equal(parseProbe(hlg, st()).video?.hdr, "HLG");
    const dv = data("probe-hdr.json");
    dv.streams[0].side_data_list = [{ side_data_type: "DOVI configuration record" }];
    assert.equal(parseProbe(dv, st()).video?.hdr, "Dolby Vision");
  });

  it("is 10-bit for p10/p12 formats, not for nv12 or yuv420p", () => {
    const tenBit = (pix: string) => {
      const j = data("probe-mp4.json");
      j.streams[0].pix_fmt = pix;
      return parseProbe(j, st()).video?.tenBit;
    };
    assert.equal(tenBit("yuv420p10le"), true);
    assert.equal(tenBit("yuv420p12le"), true);
    assert.equal(tenBit("p010le"), true);
    assert.equal(tenBit("nv12"), false);
    assert.equal(tenBit("yuv420p"), false);
  });

  it("is interlaced only for tt, bb, tb and bt; unknown is progressive (S3)", () => {
    const il = (order: string) => {
      const j = data("probe-mp4.json");
      j.streams[0].field_order = order;
      return parseProbe(j, st()).video?.interlaced;
    };
    for (const o of ["tt", "bb", "tb", "bt"]) assert.equal(il(o), true, o);
    for (const o of ["unknown", "progressive"]) assert.equal(il(o), false, o);
    assert.equal(parseProbe(data("probe-avi.json"), st()).video?.interlaced, false);
  });

  it("has no video when there is no video stream", () => {
    const f = parseProbe({ streams: [{ codec_type: "audio", codec_name: "aac" }], format: { format_name: "matroska,webm" } }, st());
    assert.equal(f.video, null);
    assert.equal(f.videoStreams, 0);
  });
});

describe("bucketRes", () => {
  const cases: [number, number, string][] = [
    [720, 480, "480p"], [1280, 720, "720p"], [1920, 1080, "1080p"], [3840, 2160, "2160p"],
    [1920, 800, "1080p"], [1280, 536, "720p"], [3840, 1600, "2160p"],
  ];
  for (const [w, h, res] of cases) it(`${w}x${h} is ${res}`, () => assert.equal(bucketRes(w, h), res));
});

describe("probeReason", () => {
  it("is short, fixed and free of the path", () => {
    assert.equal(probeReason({ killed: true }, "/mnt/media/a.mkv"), "ffprobe timed out");
    assert.equal(probeReason({ stderr: "/mnt/media/a.mkv: Invalid data found\nmore" }, "/mnt/media/a.mkv"), "ffprobe failed: : Invalid data found");
    assert.equal(probeReason({ stderr: "x".repeat(500) }, "/p").length, "ffprobe failed: ".length + 120);
    assert.equal(probeReason({}, "/p"), "ffprobe failed");
  });
});

describe("probeFile failure text", () => {
  const run = (script: string, timeoutMs?: number) =>
    probeFile("/mnt/media/secret/a.mkv", st(), { prefix: [process.execPath, "-e", script], timeoutMs });
  it("holds a short reason, never the command line or the path", async () => {
    const f = await run('process.stderr.write(process.argv.at(-1) + ": Invalid data\\nx"); process.exit(1)');
    assert.equal(f.probeError, "ffprobe failed: : Invalid data");
  });
  it("says timed out when the limit kills it", async () => {
    assert.equal((await run("setTimeout(() => {}, 5000)", 200)).probeError, "ffprobe timed out");
  });
});

describe("probeFile (real ffprobe)", { skip: SKIP_OFF_LINUX }, () => {
  it("reads a 2-second synthetic clip", async (t) => {
    if (!needFfmpeg(t)) return;
    const dir = tempDir("mw-probe-");
    try {
      const clip = join(dir, "clip.mkv");
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25", "-t", "2",
        "-c:v", "libx264", "-b:v", "4M", clip]);
      const f = await probeFile(clip, st({ path: "movies/clip/clip.mkv", name: "clip.mkv" }));
      assert.equal(f.probeError, undefined);
      assert.equal(f.video?.res, "720p");
      assert.equal(f.video?.codec, "h264");
      assert.equal(f.container, "matroska");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("turns a file ffprobe can't read into probeError without throwing", async (t) => {
    if (!needFfmpeg(t)) return;
    const dir = tempDir("mw-probe-");
    try {
      const f = await probeFile(join(dir, "missing.mkv"), st());
      assert.ok(f.probeError);
      assert.equal(f.video, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

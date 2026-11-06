import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeArgs, streamInfos, type StreamInfo } from "./encode-args.ts";
import { CRF } from "./sweet-spot.ts";

const cover: StreamInfo[] = [
  { index: 0, type: "video", attachedPic: true },
  { index: 1, type: "video", attachedPic: false },
  { index: 2, type: "audio", attachedPic: false },
  { index: 3, type: "data", attachedPic: false },
  { index: 4, type: "subtitle", attachedPic: false },
];
const base = { src: "/m/in.mkv", out: "/w/1.part", container: "matroska", crf: CRF["1080p"].film, prefix: [] as string[] };
const after = (a: string[], flag: string) => a[a.indexOf(flag) + 1];

describe("encodeArgs", () => {
  it("puts -tune grain right after the preset, never inside -x265-params", () => {
    const a = encodeArgs({ ...base, streams: cover, tune: "grain" });
    assert.equal(a[a.indexOf("-preset") + 2], "-tune");
    assert.equal(a[a.indexOf("-preset") + 3], "grain");
    assert.ok(!after(a, "-x265-params").includes("tune="));
    assert.ok(!encodeArgs({ ...base, streams: cover, tune: null }).includes("-tune"));
    assert.ok(!encodeArgs({ ...base, streams: cover }).includes("-tune"));
  });

  it("re-encodes the main video, not the cover art at index 0", () => {
    const a = encodeArgs({ ...base, streams: cover });
    assert.equal(a.indexOf("-c:1") >= 0, true);
    assert.equal(after(a, "-c:1"), "libx265");
    assert.equal(a.includes("-c:0"), false);
    assert.equal(after(a, "-c"), "copy");
  });

  it("maps every stream but data, in input order", () => {
    const a = encodeArgs({ ...base, streams: cover });
    const maps = a.flatMap((x, i) => (x === "-map" ? [a[i + 1]] : []));
    assert.deepEqual(maps, ["0:0", "0:1", "0:2", "0:4"]);
    assert.ok(a.includes("-map_chapters") && a.includes("-map_metadata"));
  });

  it("the output index follows the mapped list once a data stream is dropped", () => {
    const streams: StreamInfo[] = [
      { index: 0, type: "data", attachedPic: false },
      { index: 1, type: "video", attachedPic: false },
    ];
    assert.equal(encodeArgs({ ...base, streams }).includes("-c:0"), true);
  });

  it("mp4 gets -f mp4, faststart and the hvc1 tag; matroska gets neither tag nor faststart (S7)", () => {
    const mp4 = encodeArgs({ ...base, container: "mov", streams: cover });
    assert.equal(after(mp4, "-f"), "mp4");
    assert.equal(after(mp4, "-movflags"), "+faststart");
    assert.equal(after(mp4, "-tag:1"), "hvc1");
    const mkv = encodeArgs({ ...base, streams: cover });
    assert.equal(after(mkv, "-f"), "matroska");
    assert.equal(mkv.some((x) => x.startsWith("-tag")), false);
    assert.equal(mkv.includes("+faststart"), false);
  });

  it("never rescales or changes the frame rate", () => {
    const a = encodeArgs({ ...base, streams: cover });
    for (const bad of ["-r", "-vf", "-filter:v", "-s"]) assert.equal(a.includes(bad), false, bad);
    assert.equal(a.some((x) => /scale/.test(x)), false);
    assert.equal(after(a, "-fps_mode"), "passthrough");
  });

  it("uses the CRF it was given and clears the stale statistics tags on the output stream (S2)", () => {
    const a = encodeArgs({ ...base, crf: CRF["2160p"].tv, streams: cover });
    assert.equal(after(a, "-crf"), String(CRF["2160p"].tv));
    const cleared = a.flatMap((x, i) => (x === "-metadata:s:1" ? [a[i + 1]] : []));
    assert.ok(cleared.includes("BPS=") && cleared.includes("NUMBER_OF_BYTES-eng="));
  });

  it("starts with the nice prefix by default and ends with the output path", () => {
    const a = encodeArgs({ ...base, prefix: undefined, streams: cover });
    assert.deepEqual(a.slice(0, 7), ["nice", "-n", "19", "ionice", "-c", "3", "ffmpeg"]);
    assert.equal(a.at(-1), "/w/1.part");
  });

  it("refuses a file with no video stream", () => {
    assert.throws(() => encodeArgs({ ...base, streams: [{ index: 0, type: "audio", attachedPic: false }] }), /No video stream/);
  });
});

describe("streamInfos", () => {
  it("reads index, type and the attached-picture flag from ffprobe's JSON", () => {
    const json = { streams: [{ index: 0, codec_type: "video", disposition: { attached_pic: 1 } }, { index: 1, codec_type: "audio" }] };
    assert.deepEqual(streamInfos(json), [
      { index: 0, type: "video", attachedPic: true },
      { index: 1, type: "audio", attachedPic: false },
    ]);
  });
});

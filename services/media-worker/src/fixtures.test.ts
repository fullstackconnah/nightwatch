// Makes the synthetic library with the real ffmpeg, scans it with the real ffprobe, and checks every verdict.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { probeFile } from "./probe.ts";
import { createScanner, type Scanner } from "./scan.ts";
import { ffmpegMissing, SKIP_OFF_LINUX, tempDir } from "./testkit.ts";

const SCRIPT = fileURLToPath(new URL("../fixtures/make-fixtures.sh", import.meta.url));

describe("fixtures", { skip: SKIP_OFF_LINUX }, () => {
  let media: string;
  let state: string;
  let scanner: Scanner;

  before(async () => {
    // CI must have ffmpeg; a local Linux box without it fails here too, with the reason.
    assert.ok(!ffmpegMissing(), "ffmpeg is required for the fixtures suite (CI must install ffmpeg)");
    media = tempDir("mw-fx-");
    state = tempDir("mw-fxs-");
    execFileSync("sh", [SCRIPT, media], { stdio: "inherit" });
    scanner = createScanner({ mediaRoot: media, stateDir: state, probe: probeFile, env: { MEDIA_WORKER_TEST_THRESHOLDS: "1" } });
    scanner.start();
    await scanner.whenIdle();
  });
  after(() => { rmSync(media, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); });

  const verdictOf = (path: string) => scanner.files()[path]?.verdict;

  const EXPECT: [string, string, string?][] = [
    ["movies/Big Film (2001)/Big Film.mkv", "compress"],
    ["movies/Scope Film (2010)/Scope Film.mkv", "compress"],
    ["movies/Lean Film (2015)/Lean Film.mkv", "ok", "Already under the sweet spot"],
    ["movies/Phone Film (2018)/Phone Film.mp4", "compress"],
    ["movies/Old Film (1999)/Old Film.avi", "cant", "AVI can't hold HEVC here"],
    ["movies/HDR Film (2020)/HDR Film.mkv", "skip", "HDR10"],
    ["movies/Laced (2003)/Laced.mkv", "skip", "Interlaced"],
    ["movies/Cover Film (2012)/Cover Film.mp4", "compress"],
    ["movies/Broken (2000)/Broken.mkv", "skip", "Couldn't read this file"],
    ["tv/Test Show/Season 01/Test Show S01E01.mkv", "compress"],
    ["tv/Test Show/Season 01/Test Show S01E02.mkv", "compress"],
    ["tv/Test Show/Season 02/Test Show S02E01.mkv", "ok"],
  ];
  for (const [path, kind, reason] of EXPECT) {
    it(`${path} is ${kind}`, () => {
      const v = verdictOf(path);
      assert.equal(v?.kind, kind, JSON.stringify(v));
      if (reason) assert.equal(v && "reason" in v && v.reason, reason);
    });
  }

  it("the scope film is judged in the 1080p bucket", () => {
    assert.equal(scanner.files()["movies/Scope Film (2010)/Scope Film.mkv"].video?.res, "1080p");
  });

  it("the cover film has one video stream", () => {
    assert.equal(scanner.files()["movies/Cover Film (2012)/Cover Film.mp4"].videoStreams, 1);
  });

  it("the big film keeps two audio languages and a subtitle", () => {
    const f = scanner.files()["movies/Big Film (2001)/Big Film.mkv"];
    assert.deepEqual(f.audio.map((a) => a.lang), ["eng", "fra"]);
    assert.equal(f.subs.length, 1);
  });

  it("the broken file carries a probeError, and the decoy is never listed", () => {
    assert.ok(scanner.files()["movies/Broken (2000)/Broken.mkv"].probeError);
    assert.ok(!Object.keys(scanner.files()).some((p) => p.startsWith("music/")));
    assert.equal(scanner.state().skipped, 0);
  });
});

import assert from "node:assert/strict";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { calibrate, clean, formatRows } from "./calibrate.ts";
import { makeClip } from "./clips.ts";
import { dirsFor } from "./disk.ts";
import { needFfmpeg, tempDir } from "./testkit.ts";

describe("calibrate (B10)", () => {
  let root: string;
  let ok = true;
  before((t) => {
    root = tempDir("mw-calib-");
    mkdirSync(join(root, "movies"));
    const dirs = dirsFor(root);
    mkdirSync(dirs.calibration, { recursive: true });
    if (!needFfmpeg(t)) { ok = false; return; }
    makeClip(join(root, "movies", "Film.mkv"), { kind: "mkv" });
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  const resolve = (rel: string, r: string) => ({ abs: join(r, rel) });

  it("a 4 s source gives 3 encodes and a 3-row report; VMAF is n/a when the filter is missing", async (t) => {
    if (!ok) return t.skip("no ffmpeg");
    const dirs = dirsFor(root);
    const rows = await calibrate({ rels: ["movies/Film.mkv"], mediaRoot: root, dirs, cutSec: 3, prefix: [], filters: "no vmaf here", resolve });
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.crf), [16, 18, 20]);
    assert.ok(rows.every((r) => r.bytes > 0 && r.kbps > 0 && r.vmafMean === null));
    assert.ok(rows[0].bytes > rows[2].bytes, "a lower CRF is a bigger file");
    const text = formatRows(rows, false);
    assert.match(text, /n\/a/);
    assert.match(text, /VMAF unavailable: eyeball check/);
    assert.equal(readdirSync(dirs.calibration).length >= 4, true);
  });

  it("--clean removes only what is inside calibration/", async (t) => {
    if (!ok) return t.skip("no ffmpeg");
    const dirs = dirsFor(root);
    assert.ok(clean(dirs) >= 4);
    assert.deepEqual(readdirSync(dirs.calibration), []);
    assert.equal(readdirSync(join(root, "movies")).includes("Film.mkv"), true);
  });
});

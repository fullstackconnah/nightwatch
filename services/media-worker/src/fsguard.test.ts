import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createGuard } from "./fsguard.ts";
import { tempDir } from "./testkit.ts";

describe("removeInside (S1, M2)", () => {
  let root: string;
  let g: ReturnType<typeof createGuard>;
  const hold = () => join(root, "hold");
  const work = () => join(root, "work");
  before(() => {
    root = tempDir("mw-guard-");
    mkdirSync(hold()); mkdirSync(work()); mkdirSync(join(root, "work-old")); mkdirSync(join(root, "calib"));
    g = createGuard({ hold: hold(), work: work(), calibration: join(root, "calib") });
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("removes work/x.part (the dirname IS the allowed dir)", () => {
    const p = join(work(), "x.part");
    writeFileSync(p, "x");
    g.removeInside(work(), p);
    assert.equal(existsSync(p), false);
  });

  it("refuses work-old/x: a bare prefix match is not inside work", () => {
    const p = join(root, "work-old", "x");
    writeFileSync(p, "x");
    assert.throws(() => g.removeInside(work(), p), /outside/i);
    assert.equal(existsSync(p), true);
  });

  it("removes an empty hold/<id> folder but refuses hold itself", () => {
    const d = join(hold(), "job1");
    mkdirSync(d);
    g.removeInside(hold(), d);
    assert.equal(existsSync(d), false);
    assert.throws(() => g.removeInside(hold(), hold()), /refus|outside/i);
    assert.equal(existsSync(hold()), true);
  });

  it("refuses a directory that still has files in it (no recursive delete)", () => {
    const d = join(hold(), "job2");
    mkdirSync(d);
    writeFileSync(join(d, "f"), "x");
    assert.throws(() => g.removeInside(hold(), d));
    assert.equal(existsSync(join(d, "f")), true);
  });

  it("refuses a dir that is not one of the three allowed folders", () => {
    assert.throws(() => g.removeInside(root, join(root, "work-old", "x")), /not an allowed/i);
  });

  it("refuses ../ escapes and an empty or dot basename", () => {
    writeFileSync(join(root, "keep.txt"), "keep");
    assert.throws(() => g.removeInside(work(), join(work(), "..", "keep.txt")), /outside/i);
    assert.throws(() => g.removeInside(work(), work() + "/."), /refus|outside/i);
    assert.equal(readFileSync(join(root, "keep.txt"), "utf8"), "keep");
  });

  it("a hold file with a single link is the only copy: refused unless it is a purge (M2)", () => {
    const d = join(hold(), "job3");
    mkdirSync(d);
    const f = join(d, "orig.mkv");
    writeFileSync(f, "the only copy");
    assert.throws(() => g.removeInside(hold(), f), /only copy/i);
    assert.equal(existsSync(f), true);
    // A rollback has linked the file back at its path, so it has two links and may go.
    const back = join(root, "back.mkv");
    linkSync(f, back);
    g.removeInside(hold(), f);
    assert.equal(existsSync(f), false);
    assert.equal(readFileSync(back, "utf8"), "the only copy");
    // The purge says so and may delete a single-link file.
    const p = join(d, "old.mkv");
    writeFileSync(p, "x");
    g.removeInside(hold(), p, { purge: true });
    assert.equal(readdirSync(d).length, 0);
  });
});

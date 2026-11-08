import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { checkReady, diskMessage, enoughFor, freeBytes } from "./disk.ts";
import { DISK_MARGIN_BYTES } from "./sweet-spot.ts";
import { tempDir } from "./testkit.ts";

const GB = 2 ** 30;
const fake = (free: number) => () => ({ bavail: free / 4096, bsize: 4096 });

describe("disk guard (B6)", () => {
  it("reads free bytes as bavail * bsize", () => assert.equal(freeBytes(fake(5 * GB), "/x"), 5 * GB));

  it("enough only when free >= source + 20 GB margin", () => {
    assert.equal(enoughFor(fake(30 * GB + 1), "/x", 10 * GB), true);
    assert.equal(enoughFor(fake(30 * GB - 4096), "/x", 10 * GB), false);
    assert.equal(DISK_MARGIN_BYTES, 20 * GB);
  });

  it("the 507 sentence names both sizes and, when originals are held, the earliest date", () => {
    const m = diskMessage(10 * GB, 12.3 * GB, "2026-11-12T03:00:00Z", "Australia/Sydney");
    assert.equal(m, "Needs 30.0 GB free to compress this file; 12.3 GB is free. Space from compressed files comes back when their originals are deleted on 12 Nov.");
    assert.ok(m.length < 200);
    assert.equal(diskMessage(10 * GB, 12.3 * GB, null), "Needs 30.0 GB free to compress this file; 12.3 GB is free.");
  });
});

describe("checkReady (S5, O5)", () => {
  const media = () => {
    const root = tempDir("mw-ready-");
    mkdirSync(join(root, "movies")); mkdirSync(join(root, "tv"));
    return root;
  };

  it("not ready when .nightwatch is missing", () => {
    const root = media();
    const r = checkReady(root);
    assert.equal(r.ready, false);
    assert.equal(r.reason, "Hold folder missing or not writable");
    rmSync(root, { recursive: true, force: true });
  });

  it("not ready, never throws, when movies/ and tv/ are missing (hunt 16 B5)", () => {
    const root = tempDir("mw-ready-nomedia-");
    mkdirSync(join(root, ".nightwatch"));
    const r = checkReady(root);
    assert.equal(r.ready, false);
    assert.equal(r.reason, "Media folders missing");
    rmSync(root, { recursive: true, force: true });
  });

  it("ready when .nightwatch is writable on the same disk; makes hold, work and calibration", () => {
    const root = media();
    mkdirSync(join(root, ".nightwatch"));
    const r = checkReady(root);
    assert.deepEqual([r.ready, r.reason], [true, undefined]);
    assert.ok(r.dirs.hold.endsWith("hold"));
    rmSync(root, { recursive: true, force: true });
  });
});

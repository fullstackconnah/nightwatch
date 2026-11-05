import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { checkRelPath, resolveMediaPath } from "./paths.ts";
import { SKIP_OFF_LINUX, tempDir } from "./testkit.ts";

// Every case the plan names, as a string only (pure; runs anywhere).
const REJECTED: [string, string][] = [
  ["../etc/passwd", "parent segment"],
  ["/etc/passwd", "absolute"],
  ["movies/../music/a.mkv", "parent segment mid-path"],
  ["music/a.mkv", "music is out of scope"],
  ["downloads/a.mkv", "downloads is out of scope"],
  ["immich/a.jpg", "immich is out of scope"],
  ["Movies/a.mkv", "case-sensitive root"],
  ["movies/.nightwatch/x", "hidden segment"],
  [".nightwatch/hold/x", "hold folder root"],
  ["movies/./a.mkv", "dot segment"],
  ["movies//a.mkv", "empty segment"],
  ["movies/a.mkv\u0000", "NUL byte"],
  ["movies\\a.mkv", "backslash"],
  ["x".repeat(1025), "over 1024 characters"],
  ["", "empty"],
  ["movies/a/", "trailing slash"],
];

describe("checkRelPath (string rules)", () => {
  for (const [rel, why] of REJECTED) {
    it(`rejects ${why}`, () => {
      const r = checkRelPath(rel);
      assert.ok("error" in r, JSON.stringify(rel));
      assert.equal((r as { status: number }).status, 400);
    });
  }
  it("rejects a non-string", () => {
    assert.ok("error" in checkRelPath(undefined));
    assert.ok("error" in checkRelPath(42));
  });
  it("accepts movies/ and tv/ paths", () => {
    assert.deepEqual(checkRelPath("movies/A (1979)/A.mkv"), { root: "movies", segments: ["movies", "A (1979)", "A.mkv"] });
    assert.equal((checkRelPath("tv/Bluey") as { root: string }).root, "tv");
  });
  it("accepts a 1024-character path", () => {
    assert.ok(!("error" in checkRelPath(`movies/${"x".repeat(1017)}`)));
  });
  it("does not decode percent escapes (a literal %2e%2e is just a name)", () => {
    assert.ok(!("error" in checkRelPath("movies/%2e%2e/x")));
  });
});

describe("resolveMediaPath (realpath rules)", { skip: SKIP_OFF_LINUX }, () => {
  let root: string;
  let outside: string;
  before(() => {
    root = tempDir("mw-paths-");
    outside = tempDir("mw-outside-");
    for (const d of ["movies/A (1979)", "tv/Show", "music", ".nightwatch/hold"]) mkdirSync(join(root, d), { recursive: true });
    for (const f of ["movies/A (1979)/A.mkv", "music/a.mkv", "tv/Show/e1.mkv"]) writeFileSync(join(root, f), "x");
    writeFileSync(join(outside, "secret.mkv"), "x");
    symlinkSync("../music/a.mkv", join(root, "movies/link.mkv"));
    symlinkSync(outside, join(root, "tv/Linked"));
    symlinkSync(outside, join(root, "movies/A (1979)/sub"));
  });
  after(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

  it("resolves a real file and a real directory", () => {
    assert.deepEqual(resolveMediaPath("movies/A (1979)/A.mkv", root), { abs: join(root, "movies/A (1979)/A.mkv"), root: "movies" });
    assert.equal((resolveMediaPath("tv/Show", root) as { root: string }).root, "tv");
  });
  it("rejects a symlinked file", () => {
    assert.ok("error" in resolveMediaPath("movies/link.mkv", root));
  });
  it("rejects a symlinked directory, and anything under it", () => {
    assert.ok("error" in resolveMediaPath("tv/Linked", root));
    assert.ok("error" in resolveMediaPath("tv/Linked/secret.mkv", root));
    assert.ok("error" in resolveMediaPath("movies/A (1979)/sub/secret.mkv", root));
  });
  it("answers 404 for a path that does not exist", () => {
    const r = resolveMediaPath("movies/nope.mkv", root);
    assert.equal((r as { status: number }).status, 404);
  });
  it("answers 404, not a decode, for a literal %2e%2e", () => {
    assert.equal((resolveMediaPath("movies/%2e%2e/x", root) as { status: number }).status, 404);
  });
  it("refuses out-of-scope roots that exist on disk", () => {
    for (const rel of ["music/a.mkv", ".nightwatch/hold", "../" + "x"]) {
      assert.ok("error" in resolveMediaPath(rel, root), rel);
    }
  });
  it("works when the media root itself is a symlink", () => {
    const alias = join(tempDir("mw-alias-"), "root");
    symlinkSync(root, alias);
    assert.ok(!("error" in resolveMediaPath("movies/A (1979)/A.mkv", alias)));
  });
});

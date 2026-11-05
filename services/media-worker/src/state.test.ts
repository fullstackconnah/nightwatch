import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { readJson } from "./state.ts";
import { tempDir } from "./testkit.ts";

it("F4: the state folder is fsynced after the journal rename", () => {
  const src = readFileSync(new URL("./state.ts", import.meta.url), "utf8");
  const rename = src.indexOf("renameSync(tmp");
  const dirSync = src.indexOf("fsyncDir(dirname(file))");
  assert.ok(rename > 0 && dirSync > rename, "fsyncDir(dirname(file)) must follow renameSync(tmp, file)");
});

it("H5: strict read gives null for a missing file but throws on a corrupt one, leaving it unchanged", () => {
  const d = tempDir("mw-state-h5-");
  try {
    assert.equal(readJson(join(d, "jobs.json"), true), null);
    const bad = join(d, "bad.json");
    writeFileSync(bad, '{"version":1,"jobs":[{"id"');
    assert.throws(() => readJson(bad, true), /can't read .*bad.json/);
    assert.equal(readFileSync(bad, "utf8"), '{"version":1,"jobs":[{"id"');
    assert.equal(readJson(bad), null); // non-strict (the scan cache) still tolerates it
    mkdirSync(join(d, "dir.json"));
    assert.throws(() => readJson(join(d, "dir.json"), true)); // EISDIR is not "missing"
  } finally { rmSync(d, { recursive: true, force: true }); }
});

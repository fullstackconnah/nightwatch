import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

it("F4: the state folder is fsynced after the journal rename", () => {
  const src = readFileSync(new URL("./state.ts", import.meta.url), "utf8");
  const rename = src.indexOf("renameSync(tmp");
  const dirSync = src.indexOf("fsyncDir(dirname(file))");
  assert.ok(rename > 0 && dirSync > rename, "fsyncDir(dirname(file)) must follow renameSync(tmp, file)");
});

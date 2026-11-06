import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// voice.ts imports via the "@/" alias, which node:test cannot resolve, so check the source text.
test("voice unconfigured copy has no dotted-quad address", () => {
  const src = readFileSync(new URL("./voice.ts", import.meta.url), "utf8");
  const copy = /VOICE_UNCONFIGURED_DETAIL =([^;]*);/.exec(src)?.[1] ?? "";
  assert.ok(copy.includes("not connected"));
  assert.doesNotMatch(copy, /\d+\.\d+\.\d+\.\d+/);
});

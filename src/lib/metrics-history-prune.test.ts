import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("metrics history writer", () => {
  it("prunes old files even when the append failed (an unwritable dir must not keep old files forever)", () => {
    const src = readFileSync(new URL("./metrics-history.ts", import.meta.url), "utf8");
    const from = src.indexOf("warnOnce(WRITE_FAILED");
    const to = src.indexOf("await pruneOldFiles(date)");
    assert.ok(from > 0 && to > from);
    assert.ok(!/\breturn\b/.test(src.slice(from, to)), "no early return between the failed write and the prune");
  });
});

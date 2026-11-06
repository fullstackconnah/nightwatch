import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// route.ts imports next/server, which node:test cannot resolve, so guard the wiring from source.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("create and upload routes answer 400 for a memoryGb outside the cap, before any upstream call", () => {
  for (const [file, before] of [["./route.ts", "mcManager.createInstance"], ["./upload/route.ts", "fetch(upstreamUrl"]]) {
    const src = read(file);
    const check = src.indexOf("memoryGbInRange(");
    assert.ok(check > 0, file);
    assert.ok(check < src.indexOf(before), file);
    assert.match(src, /memoryGb must be above 0 and at most \$\{MAX_MEMORY_GB\}`\s*\}, \{ status: 400/, file);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The page loads `@/` aliases, which node:test cannot resolve, so scan the source instead.
test("F1: the header tally shows only while connected, never after a failed poll", () => {
  const src = readFileSync(new URL("../app/(dash)/orchestrators/page.tsx", import.meta.url), "utf8");
  assert.match(src, /const segments = connected \? tallySegments\(laneTally\(lanes\)\) : \[\];/);
});

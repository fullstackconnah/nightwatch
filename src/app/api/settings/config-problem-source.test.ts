import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("GET /api/settings reports configProblem() in meta", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(src, /meta:\s*\{[\s\S]*?configProblem: configProblem\(\),/);
});

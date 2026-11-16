import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// docker.ts imports "@/lib/...", which node:test cannot resolve, so it is source-scanned (as docker-hunt14.test.ts does).
const src = readFileSync(fileURLToPath(new URL("./docker.ts", import.meta.url)), "utf8");

test("inspect cache and requested keys live on globalThis, shared across Next bundles", () => {
  assert.match(src, /__inspectCache\?: /);
  assert.match(src, /globalForDocker\.__inspectCache \?\?= createInspectCache</);
  assert.match(src, /globalForDocker\.__requestedRuntimeKeys \?\?= \{ keys: \[\] \}/);
  assert.doesNotMatch(src, /^(const inspectCache = createInspectCache|let requestedRuntimeKeys)/m);
});

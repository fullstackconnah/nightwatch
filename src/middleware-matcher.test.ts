import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Next requires config.matcher to be a static literal in middleware.ts, so the
// test reads the source rather than importing it (the file needs @/ aliases).
const src = readFileSync(new URL("./middleware.ts", import.meta.url), "utf8");
const literal = /matcher:\s*\[\s*"([^"]+)"\s*\]/.exec(src)?.[1];
assert.ok(literal, "matcher literal not found in middleware.ts");
const matches = (path: string) => new RegExp(`^${literal}$`).test(path);

test("upload route is outside the middleware matcher (no body buffering)", () => {
  assert.equal(matches("/api/minecraft/instances/upload"), false);
});

test("everything else stays behind the middleware", () => {
  for (const p of [
    "/api/minecraft/instances",
    "/api/minecraft/instances/upload/x",
    "/api/minecraft/instances/uploadx",
    "/api/docker/containers",
    "/logs",
    "/",
  ]) {
    assert.equal(matches(p), true, p);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { busyMessage, tryBegin } from "./minecraft-busy.ts";

test("a second job is refused while one runs, then allowed after release", () => {
  const release = tryBegin("restore");
  assert.ok(release);
  assert.equal(tryBegin("start"), null);
  release();
  const again = tryBegin("start");
  assert.ok(again);
  again();
});

test("release is idempotent and a stale release cannot free a newer job", () => {
  const a = tryBegin("run")!;
  a();
  const b = tryBegin("activate")!;
  a();
  assert.equal(tryBegin("run"), null);
  b();
});

test("a throw inside try/finally releases the guard", async () => {
  await assert.rejects(async () => {
    const release = tryBegin("restore")!;
    try {
      throw new Error("manager down");
    } finally {
      release();
    }
  });
  const next = tryBegin("run");
  assert.ok(next);
  next();
});

test("the refusal names the job that holds the guard", () => {
  const release = tryBegin("restore")!;
  assert.equal(tryBegin("start"), null);
  assert.equal(busyMessage(), "Another Minecraft job is running (restore). Try again when it finishes.");
  release();
});

const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
for (const [name, path, kinds] of [
  ["backups", "../app/api/minecraft/backups/route.ts", ['"run"', '"restore"']],
  ["activate", "../app/api/minecraft/instances/[slug]/activate/route.ts", ['"activate"']],
  ["docker action", "../app/api/docker/containers/[id]/action/route.ts", ['"start"']],
] as const) {
  test(`${name} route takes the guard and releases it in finally`, () => {
    const s = src(path);
    for (const k of kinds) assert.match(s, new RegExp(`^\\s+(?:const|let) release = .*tryBegin\\(${k}\\)`, "m"));
    assert.match(s, /^\s+\} finally \{\s*\n\s+release\(\);/m);
    assert.match(s, /status: 409/);
    assert.match(s, /busyMessage\(\)/);
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { busyMessage, guardsMinecraftStart, isBusy, isGuardedAction, tryBegin } from "./minecraft-busy.ts";

test("only start and restart on the minecraft container are guarded", () => {
  assert.equal(guardsMinecraftStart("start", "minecraft"), true);
  assert.equal(guardsMinecraftStart("restart", "minecraft"), true);
  assert.equal(guardsMinecraftStart("stop", "minecraft"), false);
  assert.equal(guardsMinecraftStart("start", "jellyfin"), false);
  assert.equal(guardsMinecraftStart("start", undefined), false);
});

test("isBusy reflects the held guard", () => {
  assert.equal(isBusy(), false);
  const release = tryBegin("install")!;
  assert.equal(isBusy(), true);
  release();
  assert.equal(isBusy(), false);
});

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
  ["install", "../app/api/minecraft/instances/route.ts", ['"install"']],
  ["delete", "../app/api/minecraft/instances/[slug]/route.ts", ['"delete"']],
  ["upload", "../app/api/minecraft/instances/upload/route.ts", ['"upload"']],
] as const) {
  test(`${name} route takes the guard and releases it in finally`, () => {
    const s = src(path);
    for (const k of kinds) assert.match(s, new RegExp(`^\\s+(?:const|let) release = .*tryBegin\\(${k}\\)`, "m"));
    // One finally-release per guarded handler, so removing any one fails.
    assert.equal(s.match(/^\s+\} finally \{\s*\n\s+release\(\);/gm)?.length, kinds.length);
    assert.match(s, /busyMessage\(\) \}, \{ status: 409 \}/);
  });
}

test("docker route and MCP guard through the shared helper, start or restart on minecraft", () => {
  const route = src("../app/api/docker/containers/[id]/action/route.ts");
  assert.match(route, /guardsMinecraftStart\(action, /);
  assert.match(route, /isBusy\(\)/);
  // Stop, pause and unpause never touch the lookup, so a failed one while busy can't refuse them.
  assert.match(route, /^\s+const lookup = isGuardedAction\(action\) \? await listContainers\(\)/m);
  assert.match(route, /^\s+if \(!lookup && isBusy\(\) && isGuardedAction\(action\)\)/m);
  assert.equal(isGuardedAction("stop"), false);
  assert.equal(isGuardedAction("pause"), false);
  assert.equal(isGuardedAction("start"), true);
  assert.equal(isGuardedAction("restart"), true);
  const mcp = src("./mcp/tools.ts");
  assert.match(mcp, /guardsMinecraftStart\(action, container\.name\)/);
  assert.match(mcp, /tryBegin\("start"\)/);
  assert.match(mcp, /busyMessage\(\), true\)/);
  assert.equal(mcp.match(/^\s+\} finally \{\s*\n\s+release\(\);/gm)?.length, 1);
});

test("settings checks the base version before it saves; process names reload on a missing id", () => {
  const s = src("../app/api/settings/route.ts");
  assert.ok(s.indexOf("checkBaseVersion(") < s.indexOf("saveConfig(merged"));
  assert.match(src("./processes.ts"), /isValid: \(cached\) => allResolve\(/);
});

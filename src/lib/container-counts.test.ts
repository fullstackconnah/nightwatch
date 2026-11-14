import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectCounts } from "./container-counts.ts";

// Pins the kiosk /kiosk/api/container health response (counts, key order). The expected object is derived by hand
// from the route's old collectCounts: total = length; stopped = total - running - paused - restarting (dead falls into stopped);
// unhealthy is by `health`, so it overlaps running.
const c = (state: string, health: "healthy" | "unhealthy" | "starting" | null = null) => ({ state, health });
const list = () => [c("running", "healthy"), c("running", "unhealthy"), c("running"), c("paused"), c("restarting"), c("dead"), c("exited")];

test("kiosk counts are unchanged", async () => {
  const out = await collectCounts(async () => list());
  assert.deepEqual(out, { total: 7, running: 3, paused: 1, restarting: 1, stopped: 2, unhealthy: 1, dead: 1 });
  assert.deepEqual(Object.keys(out), ["total", "running", "paused", "restarting", "stopped", "unhealthy", "dead"]);
});

test("a docker failure still rejects", async () => {
  await assert.rejects(collectCounts(async () => { throw new Error("socket"); }));
  await assert.rejects(collectCounts(() => Promise.reject(new Error("socket"))));
});

test("the kiosk route only delegates", () => {
  const route = readFileSync(new URL("../app/kiosk/api/health/route.ts", import.meta.url), "utf8");
  assert.match(route, /throwingSnapshotRoute\(\{ collect: \(\) => collectCounts\(listContainers\) \}, 502, "docker unreachable"\)/);
  const exported = [...route.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["GET", "dynamic"]);
  assert.doesNotMatch(route, /containers\.filter/);
});

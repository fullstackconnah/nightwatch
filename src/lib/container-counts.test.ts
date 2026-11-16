import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectCounts } from "./container-counts.ts";

// Pins the kiosk /kiosk/api/container health response (counts, key order). The expected object is derived by hand
// from the route's old collectCounts: total = length; stopped = total - running - paused - restarting (dead falls into stopped);
// unhealthy is by `health`, so it overlaps running.
const c = (state: string, health: "healthy" | "unhealthy" | "starting" | null = null) => ({ name: "svc", composeProject: "app", state, health });
const list = () => [c("running", "healthy"), c("running", "unhealthy"), c("running"), c("paused"), c("restarting"), c("dead"), c("exited")];

test("kiosk counts are unchanged", async () => {
  const out = await collectCounts(async () => list());
  assert.deepEqual(out, { total: 7, running: 3, paused: 1, restarting: 1, stopped: 2, unhealthy: 1, dead: 1 });
  assert.deepEqual(Object.keys(out), ["total", "running", "paused", "restarting", "stopped", "unhealthy", "dead"]);
});

test("a down test container adds to no problem count but still counts as present", async () => {
  const tc = (state: string, health: "unhealthy" | null = null) => ({ name: "homelab-dashboard-test-proxy", composeProject: "homelab-dashboard-test", state, health });
  const out = await collectCounts(async () => [c("running"), tc("running", "unhealthy"), tc("exited"), tc("dead"), tc("restarting"), { name: "hungry_leavitt", composeProject: null, state: "exited", health: null }]);
  assert.deepEqual(out, { total: 6, running: 2, paused: 0, restarting: 0, stopped: 0, unhealthy: 0, dead: 0 });
  const real = await collectCounts(async () => [c("exited"), c("dead"), c("running", "unhealthy")]);
  assert.deepEqual(real, { total: 3, running: 1, paused: 0, restarting: 0, stopped: 2, unhealthy: 1, dead: 1 });
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

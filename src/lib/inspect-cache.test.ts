import assert from "node:assert/strict";
import { test } from "node:test";
import { createInspectCache, hasLiveStats } from "./inspect-cache.ts";

function setup() {
  let clock = 0;
  const calls: string[] = [];
  const cache = createInspectCache<string>(60_000, () => clock);
  const inspect = async (id: string) => {
    calls.push(id);
    if (id === "bad") throw new Error("gone");
    return `v${calls.length}`;
  };
  return { cache, inspect, calls, tick: (ms: number) => (clock += ms) };
}
const k = (id: string, state = "running", created = 1, status = "Up 3 days") => ({ id, state, created, status });

test("a new id is inspected once; an unchanged running id on the next poll is not", async () => {
  const { cache, inspect, calls } = setup();
  const a = await cache.resolve([k("a")], inspect);
  const b = await cache.resolve([k("a")], inspect);
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
});

test("a state change running to exited is inspected at once", async () => {
  const { cache, inspect, calls } = setup();
  await cache.resolve([k("a")], inspect);
  const out = await cache.resolve([k("a", "exited")], inspect);
  assert.equal(calls.length, 2);
  assert.equal(out.a, "v2");
});

test("a changed Created (recreated under the same id key) is inspected", async () => {
  const { cache, inspect, calls } = setup();
  await cache.resolve([k("a")], inspect);
  await cache.resolve([k("a", "running", 2)], inspect);
  assert.equal(calls.length, 2);
});

test("an id that disappears is dropped, so it is inspected again if it returns", async () => {
  const { cache, inspect, calls } = setup();
  await cache.resolve([k("a"), k("b")], inspect);
  await cache.resolve([k("a")], inspect);
  await cache.resolve([k("a"), k("b")], inspect);
  assert.deepEqual(calls, ["a", "b", "b"]);
});

test("an entry past 60 s is inspected; one at 60 s is not", async () => {
  const { cache, inspect, calls, tick } = setup();
  await cache.resolve([k("a")], inspect);
  tick(60_000);
  await cache.resolve([k("a")], inspect);
  assert.equal(calls.length, 1);
  tick(1);
  await cache.resolve([k("a")], inspect);
  assert.equal(calls.length, 2);
});

test("a failed inspect is left out of the result and nothing is cached", async () => {
  const { cache, inspect, calls } = setup();
  const out = await cache.resolve([k("a"), k("bad")], inspect);
  assert.deepEqual(Object.keys(out), ["a"]);
  await cache.resolve([k("a"), k("bad")], inspect);
  assert.deepEqual(calls, ["a", "bad", "bad"]);
});

test("clear() forces a re-inspect", async () => {
  const { cache, inspect, calls } = setup();
  await cache.resolve([k("a")], inspect);
  cache.clear();
  await cache.resolve([k("a")], inspect);
  assert.equal(calls.length, 2);
});

// docker.ts imports "@/lib/...", which node:test cannot resolve, so wiring is source-scanned.
import { readFileSync } from "node:fs";
const dockerSrc = readFileSync(new URL("./docker.ts", import.meta.url), "utf8");

test("the stats path reads the shared list memo, not a raw docker.listContainers call", () => {
  const body = dockerSrc.slice(dockerSrc.indexOf("async function collectAllContainerStats"), dockerSrc.indexOf("const statsMemo"));
  assert.doesNotMatch(body, /docker.listContainers/);
  assert.match(body, /listContainers()/);
  assert.match(body, /hasLiveStats/);
});

test("stats rows are kept for running, paused and restarting containers only", () => {
  for (const s of ["running", "paused", "restarting"]) assert.equal(hasLiveStats(s), true, s);
  for (const s of ["exited", "created", "dead"]) assert.equal(hasLiveStats(s), false, s);
});

test("a changed status text (a restart resets the uptime) is inspected; the same text is not", async () => {
  const { cache, inspect, calls } = setup();
  await cache.resolve([k("a")], inspect);
  await cache.resolve([k("a")], inspect);
  assert.equal(calls.length, 1);
  await cache.resolve([k("a", "running", 1, "Up 4 seconds")], inspect);
  assert.equal(calls.length, 2);
});

test("a resolve that began before clear() does not repopulate the cache", async () => {
  const { cache, calls } = setup();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const slow = async (id: string) => {
    calls.push(id);
    await held;
    return "old";
  };
  const first = cache.resolve([k("a")], slow);
  cache.clear();
  release();
  await first;
  const out = await cache.resolve([k("a")], async (id) => (calls.push(id), "new"));
  assert.equal(calls.length, 2);
  assert.equal(out.a, "new");
});

test("lifecycle actions and removal clear the inspect cache", () => {
  assert.equal(dockerSrc.match(/inspectCache\.clear\(\)/g)?.length, 2);
});

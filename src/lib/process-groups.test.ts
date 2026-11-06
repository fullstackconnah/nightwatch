import test from "node:test";
import assert from "node:assert/strict";
import { buildGroups, filterGroups, rankedIds, topProcs, withNewcomers, OTHER_ID, type PLike } from "./process-groups.ts";

const p = (pid: number, over: Partial<PLike> = {}): PLike => ({
  pid,
  comm: `proc${pid}`,
  cmdline: `/bin/proc${pid} --flag`,
  cpuPct: 1,
  rssBytes: 100,
  threads: 2,
  containerId: null,
  containerName: null,
  cgroupIoRate: null,
  ...over,
});
const web = { containerId: "a".repeat(64), containerName: "web", cgroupIoRate: 500 };
const db = { containerId: "b".repeat(64), containerName: "db", cgroupIoRate: 90 };

test("groups roll up per container, host procs go to other, io is taken once", () => {
  const g = buildGroups([p(1, web), p(2, web, ), p(3, db), p(4)]);
  const byId = Object.fromEntries(g.map((x) => [x.id, x]));
  assert.equal(g.length, 3);
  assert.equal(byId["a".repeat(64)].procs.length, 2);
  assert.equal(byId["a".repeat(64)].cpu, 2);
  assert.equal(byId["a".repeat(64)].mem, 200);
  assert.equal(byId["a".repeat(64)].threads, 4);
  assert.equal(byId["a".repeat(64)].io, 500);
  assert.equal(byId[OTHER_ID].name, "other · not in a container");
  assert.equal(byId[OTHER_ID].io, null);
});

test("a group with no measured cpu has null cpu, not 0", () => {
  const [g] = buildGroups([p(1, { ...web, cpuPct: null })]);
  assert.equal(g.cpu, null);
});

test("ranking: by key desc, null cpu last, ties by name", () => {
  const groups = buildGroups([p(1, { ...web, cpuPct: 1 }), p(2, { ...db, cpuPct: 5 }), p(3, { cpuPct: null })]);
  assert.deepEqual(rankedIds(groups, "cpu"), ["b".repeat(64), "a".repeat(64), OTHER_ID]);
  const tie = buildGroups([p(1, { ...web, cpuPct: 2 }), p(2, { ...db, cpuPct: 2 })]);
  assert.deepEqual(rankedIds(tie, "cpu"), ["b".repeat(64), "a".repeat(64)]); // db before web
});

test("filter matches container, comm, cmdline and exact pid only", () => {
  const groups = buildGroups([p(11, { ...web, comm: "nginx", cmdline: "/sbin/nginx" }), p(110, { ...db, comm: "postgres", cmdline: "/usr/bin/postgres -D /data" })]);
  assert.equal(filterGroups(groups, "WEB").length, 1); // container name, case-blind
  assert.equal(filterGroups(groups, "nginx").length, 1); // comm
  assert.equal(filterGroups(groups, "postgres").length, 1); // cmdline
  assert.equal(filterGroups(groups, "11").map((g) => g.name).join(), "web"); // exact pid 11, not 110
  assert.equal(filterGroups(groups, "zzz").length, 0);
  assert.equal(filterGroups(groups, "").length, 2);
  assert.equal(filterGroups(buildGroups([p(5, { ...web, comm: "ab", cmdline: "cd" })]), "bc").length, 0); // no match across the comm/cmdline join
});

test("a group matched by pid lists only its hits; a name match lists all", () => {
  const groups = buildGroups([p(1, web), p(2, web), p(3, db)]);
  const [byPid] = filterGroups(groups, "2");
  assert.deepEqual(topProcs(byPid, "2", "cpu").map((x) => x.pid), [2]);
  const [byName] = filterGroups(groups, "web");
  assert.equal(topProcs(byName, "web", "cpu").length, 2);
});

test("topProcs caps at 12 and orders by the key; null cpu last", () => {
  const procs = Array.from({ length: 15 }, (_, i) => p(i + 1, { ...web, cpuPct: i === 3 ? null : i, rssBytes: i }));
  const [g] = buildGroups(procs);
  const top = topProcs(g, "", "cpu");
  assert.equal(top.length, 12);
  assert.equal(top[0].pid, 15);
  assert.ok(!top.some((x) => x.cpuPct == null));
  assert.equal(topProcs(g, "", "mem")[0].pid, 15);
});

test("withNewcomers: a group that newly matches joins the end of a held order; vanished ids are dropped", () => {
  assert.deepEqual(withNewcomers(["a", "b"], ["b", "c", "a"]), ["a", "b", "c"]);
  assert.deepEqual(withNewcomers(["a", "gone"], ["a"]), ["a"]);
  assert.deepEqual(withNewcomers(null, ["x"]), ["x"]);
});

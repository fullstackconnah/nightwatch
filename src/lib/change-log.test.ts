import test from "node:test";
import assert from "node:assert/strict";
import { countText, diffTick, parseBaseline, parseLines, tally, type Baseline, type ChangeLine, type LiveContainer } from "./change-log.ts";

const T0 = Date.UTC(2026, 10, 12, 10, 0, 0);
const MIN = 60_000;
const live = (name: string, o: Partial<LiveContainer> = {}): LiveContainer => ({
  id: `${name}-id`,
  name,
  state: "running",
  startedAt: T0 - 5 * 60 * MIN,
  finishedAt: null,
  exitCode: null,
  restartCount: 0,
  ...o,
});
const five = ["a", "b", "c", "d", "e"].map((n) => live(n));
const entryOf = (c: LiveContainer) => ({ id: c.id, startedAt: c.startedAt, finishedAt: c.finishedAt, restartCount: c.restartCount, seen: T0 });
const baselineOf = (cs: LiveContainer[], lastTickAt = T0): Baseline => ({
  seededAt: T0 - 1000,
  lastTickAt,
  byName: Object.fromEntries(cs.map((c) => [c.name, entryOf(c)])),
});

test("T1 first tick with no baseline writes no lines and seeds all names; a baseline equal to live writes none", () => {
  const r = diffTick(null, five, T0);
  assert.deepEqual(r.lines, []);
  assert.deepEqual(Object.keys(r.baseline.byName).sort(), ["a", "b", "c", "d", "e"]);
  assert.equal(r.baseline.seededAt, T0);
  assert.equal(r.baseline.lastTickAt, T0);
  assert.deepEqual(diffTick(baselineOf(five), five, T0 + 30_000).lines, []);
});

test("T2 a start during downtime is recovered once, at Docker's own time", () => {
  const prev = baselineOf([live("sonarr", { startedAt: 1000 })]);
  const now = live("sonarr", { startedAt: 5000 });
  const r = diffTick(prev, [now], T0);
  assert.deepEqual(r.lines, [{ at: 5000, k: "start", name: "sonarr", id: "sonarr-id" }]);
  assert.deepEqual(diffTick(r.baseline, [now], T0 + 30_000).lines, []);
});

test("T3 an unknown runtime is not an observation: nothing written, entry kept", () => {
  const good = live("sonarr", { startedAt: 1000 });
  const prev = baselineOf([good]);
  const r = diffTick(prev, [live("sonarr", { startedAt: null })], T0);
  assert.deepEqual(r.lines, []);
  assert.deepEqual(r.baseline.byName.sonarr, prev.byName.sonarr);
  assert.deepEqual(diffTick(r.baseline, [good], T0 + 30_000).lines, []);
  // not running with both times null is unknown too
  const x = diffTick(prev, [live("sonarr", { state: "exited", startedAt: null, finishedAt: null })], T0);
  assert.deepEqual(x.lines, []);
  assert.deepEqual(x.baseline.byName.sonarr, prev.byName.sonarr);
});

test("T4 policy restarts between ticks: one restart line with n = the count delta", () => {
  const prev = baselineOf([live("sonarr", { startedAt: 1000, restartCount: 1 })]);
  const r = diffTick(prev, [live("sonarr", { startedAt: 9000, restartCount: 3 })], T0);
  assert.deepEqual(r.lines, [{ at: 9000, k: "restart", name: "sonarr", id: "sonarr-id", n: 2 }]);
});

test("T5 a recreated container keeps one history by name", () => {
  const prev = baselineOf([live("sonarr", { id: "old", startedAt: 1000 })]);
  const r = diffTick(prev, [live("sonarr", { id: "new", startedAt: 7000 })], T0);
  assert.deepEqual(r.lines, [{ at: 7000, k: "recreate", name: "sonarr", id: "new" }]);
  assert.equal(r.baseline.byName.sonarr.id, "new");
  const lines: ChangeLine[] = [
    { at: 1000, k: "start", name: "sonarr", id: "old" },
    { at: 7000, k: "recreate", name: "sonarr", id: "new" },
    { at: 8000, k: "restart", name: "sonarr", id: "new", n: 1 },
  ];
  const t = tally(lines, 0);
  assert.equal(t.size, 1);
  assert.equal(t.get("sonarr")?.starts, 3);
  assert.equal(t.get("sonarr")?.byItself, 1);
  assert.equal(t.get("sonarr")?.lastStartAt, 8000);
});

test("T6 a start time that moved back still counts", () => {
  const prev = baselineOf([live("sonarr", { startedAt: 5000 })]);
  const r = diffTick(prev, [live("sonarr", { startedAt: 4000 })], T0);
  assert.deepEqual(r.lines, [{ at: 4000, k: "start", name: "sonarr", id: "sonarr-id" }]);
});

test("T7 a lower restart count with the same start time: no line, new stored count", () => {
  const prev = baselineOf([live("sonarr", { startedAt: 5000, restartCount: 4 })]);
  const r = diffTick(prev, [live("sonarr", { startedAt: 5000, restartCount: 0 })], T0);
  assert.deepEqual(r.lines, []);
  assert.equal(r.baseline.byName.sonarr.restartCount, 0);
  // a start with a reset count is a plain start
  const s = diffTick(prev, [live("sonarr", { startedAt: 6000, restartCount: 0 })], T0);
  assert.deepEqual(s.lines.map((l) => l.k), ["start"]);
});

test("a stop is written once, with the exit code", () => {
  const prev = baselineOf([live("sonarr", { startedAt: 1000 })]);
  const gone = live("sonarr", { state: "exited", startedAt: 1000, finishedAt: 6000, exitCode: 137 });
  const r = diffTick(prev, [gone], T0);
  assert.deepEqual(r.lines, [{ at: 6000, k: "stop", name: "sonarr", id: "sonarr-id", code: 137 }]);
  assert.deepEqual(diffTick(r.baseline, [gone], T0 + 30_000).lines, []);
  const nocode = diffTick(prev, [{ ...gone, exitCode: null }], T0);
  assert.equal("code" in nocode.lines[0], false);
});

test("T17 a seed tick with every inspect failed, then a good tick: no lines", () => {
  const unknown = ["a", "b"].map((n) => live(n, { startedAt: null }));
  const seed = diffTick(null, unknown, T0);
  assert.deepEqual(seed.baseline.byName, {});
  const good = ["a", "b"].map((n) => live(n, { startedAt: T0 - 3600_000 }));
  assert.deepEqual(diffTick(seed.baseline, good, T0 + 30_000).lines, []);
  // but a container that started after the last completed tick is a real start
  const fresh = diffTick(seed.baseline, [live("c", { startedAt: T0 + 10_000 })], T0 + 30_000);
  assert.deepEqual(fresh.lines.map((l) => l.k), ["start"]);
});

test("T18 a rename (same id, new name): no line, the entry moves", () => {
  const prev = baselineOf([live("old-name", { id: "x1" })]);
  const r = diffTick(prev, [live("new-name", { id: "x1" })], T0);
  assert.deepEqual(r.lines, []);
  assert.deepEqual(Object.keys(r.baseline.byName), ["new-name"]);
});

test("names absent from live stay in the baseline until 30 days old", () => {
  const prev = baselineOf([live("gone")]);
  const kept = diffTick(prev, [], T0 + 29 * 86_400_000);
  assert.ok("gone" in kept.baseline.byName);
  const dropped = diffTick(prev, [], T0 + 31 * 86_400_000);
  assert.ok(!("gone" in dropped.baseline.byName));
});

const good = (n: string, at: number) => JSON.stringify({ at, k: "start", name: n, id: "abc" });

test("T8 a corrupt or invalid line is skipped, not fatal", () => {
  const text = [
    good("a", 1),
    "{bad",
    JSON.stringify({ at: 1e20, k: "start", name: "x", id: "abc" }), // past the largest valid Date: toISOString would throw
    good("b", 2),
    '{"at":1',
    JSON.stringify({ at: 3, k: "boom", name: "c", id: "x" }),
    JSON.stringify({ at: 4, k: "restart", name: "c", id: "x", n: -1 }),
    JSON.stringify({ at: 5, k: "stop", name: "", id: "x" }),
    JSON.stringify({ at: 6, k: "stop", name: "c", id: "x", code: 1.5 }),
    JSON.stringify({ at: "7", k: "start", name: "c", id: "x" }),
  ].join("\n");
  assert.deepEqual(parseLines(text).map((l) => l.name), ["a", "b"]);
  assert.equal(parseLines("").length, 0);
  assert.equal(parseLines(JSON.stringify({ at: 1, k: "start", name: "x".repeat(256), id: "i" })).length, 0);
});

test("T9 the same line twice counts once", () => {
  const l = parseLines(`${good("a", 5)}\n${good("a", 5)}\n`);
  assert.equal(tally(l, 0).get("a")?.starts, 1);
});

test("tally counts only lines after since and tracks stops", () => {
  const lines: ChangeLine[] = [
    { at: 100, k: "start", name: "a", id: "i" },
    { at: 200, k: "restart", name: "a", id: "i", n: 2 },
    { at: 300, k: "stop", name: "a", id: "i", code: 1 },
    { at: 400, k: "stop", name: "a", id: "i" },
  ];
  const t = tally(lines, 150).get("a");
  assert.deepEqual(t, { starts: 2, byItself: 2, lastStartAt: 200, stops: 2, lastStopAt: 400, lastCode: null });
});

test("T15 countText rows 1-6", () => {
  const t = (starts: number, byItself: number) => ({ starts, byItself });
  assert.equal(countText("x", "start", t(1, 0)), "x started");
  assert.equal(countText("x", "start", t(4, 0)), "x restarted 4 times");
  assert.equal(countText("x", "start", t(1, 1)), "x restarted itself and is running again");
  assert.equal(countText("x", "start", t(4, 4)), "x restarted itself 4 times");
  assert.equal(countText("x", "start", t(4, 3)), "x restarted 4 times, 3 by itself");
  assert.equal(countText("x", "stop", { stops: 1, lastCode: 137 }), "x stopped (exit 137)");
  assert.equal(countText("x", "stop", { stops: 1, lastCode: null }), "x stopped");
  assert.equal(countText("x", "stop", { stops: 3, lastCode: 2 }), "x stopped 3 times (last exit 2)");
  assert.equal(countText("x", "stop", { stops: 3, lastCode: null }), "x stopped 3 times");
});

test("parseBaseline rejects anything without finite seededAt and lastTickAt", () => {
  const ok = { seededAt: 1, lastTickAt: 2, byName: { a: { id: "i", startedAt: 1, finishedAt: null, restartCount: 0, seen: 3 } } };
  assert.deepEqual(parseBaseline(JSON.stringify(ok)), ok);
  const bads = [
    "",
    "garbage",
    "[]",
    JSON.stringify({ ...ok, lastTickAt: undefined }),
    JSON.stringify({ ...ok, seededAt: "1" }),
    JSON.stringify({ ...ok, byName: { a: { id: 1 } } }),
    JSON.stringify({ ...ok, byName: null }),
  ];
  for (const bad of bads) assert.equal(parseBaseline(bad), null);
});

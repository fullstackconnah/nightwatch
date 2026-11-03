import test from "node:test";
import assert from "node:assert/strict";
import { parseView, stackLayers, holdNearTies, adoptPick, ringTail, rangeAvgs, sparkMode } from "./timeline.ts";
const topIds = (ids: string[], n: number) => ids.slice(0, n);

test("parseView accepts only the two values", () => {
  assert.equal(parseView("timeline"), "timeline");
  assert.equal(parseView("watch"), "watch");
  for (const v of [null, undefined, "", "Timeline", "all", "watchlist", 3]) assert.equal(parseView(v), "watch");
});

test("stackLayers: picks in slot order, then rest, then host & other, summing to the host", () => {
  const r = stackLayers({ host: [50, 40], containersTotal: [30, 30], picks: [[10, 5], [8, 5]] });
  assert.deepEqual(r.picks, [[[0, 10], [0, 5]], [[10, 18], [5, 10]]]);
  assert.deepEqual(r.rest, [[18, 30], [10, 30]]);
  assert.deepEqual(r.other, [[30, 50], [30, 40]]);
  assert.deepEqual(r.top, [50, 40]);
});

test("stackLayers clamps rest and other at 0 when containers exceed the host", () => {
  const r = stackLayers({ host: [20], containersTotal: [30], picks: [[35]] });
  assert.deepEqual(r.rest, [[35, 35]]);
  assert.deepEqual(r.other, [[35, 35]]);
});

test("stackLayers: a null host bucket is a gap; a null pick stacks as 0", () => {
  const r = stackLayers({ host: [null, 10], containersTotal: [null, 6], picks: [[null, null]] });
  assert.deepEqual(r.gap, [true, false]);
  assert.deepEqual(r.picks[0][1], [0, 0]);
  assert.deepEqual(r.rest[1], [0, 6]);
});

test("holdNearTies keeps order at +4.9% and swaps at +5.1%", () => {
  const prev = ["a", "b"];
  assert.deepEqual(holdNearTies(prev, new Map([["a", 100], ["b", 104.9]])), ["a", "b"]);
  assert.deepEqual(holdNearTies(prev, new Map([["a", 100], ["b", 105.1]])), ["b", "a"]);
});

test("holdNearTies always re-sorts when the set changes", () => {
  assert.deepEqual(holdNearTies(["a", "b"], new Map([["a", 100], ["b", 101], ["c", 102]])), ["c", "b", "a"]);
});

test("adoptPick: untick in auto leaves 3 picks", () => {
  assert.deepEqual(adoptPick(["a", "b", "c", "d"], [], "b"), ["a", "c", "d"]);
});

test("adoptPick: tick an uncharted id in auto replaces auto[3]", () => {
  assert.deepEqual(adoptPick(["a", "b", "c", "d"], [], "x"), ["a", "b", "c", "x"]);
});

test("adoptPick: never more than 4; toggles off; empties back to auto", () => {
  assert.deepEqual(adoptPick([], ["a", "b", "c", "d"], "e"), ["a", "b", "c", "d"]);
  assert.deepEqual(adoptPick([], ["a", "b"], "c"), ["a", "b", "c"]);
  assert.deepEqual(adoptPick([], ["a", "b"], "a"), ["b"]);
  assert.deepEqual(adoptPick([], ["a"], "a"), []);
});

// 1H: 30 s buckets, t = bucket START (metrics-history.ts emitBuckets)
const W = 30_000;
const ts = [0, 30_000, 60_000, 90_000, 120_000];
const old = [1, 1, 1, 1, 1];
const ring = (from: number, to: number, v: number) => {
  const out: { ts: number; v: number }[] = [];
  for (let t = from; t <= to; t += 1000) out.push({ ts: t, v });
  return out;
};

test("ringTail at 1h overrides fully covered buckets and the partial one only", () => {
  // ring 60 s..110 s: bucket 60k fully covered, bucket 90k covered to 110 s (the partial current one)
  const r = ringTail(old, ts, ring(60_000, 110_000, 9), W, "1h");
  assert.deepEqual(r, [1, 1, 9, 9, 1]);
});

test("ringTail leaves a bucket the ring only starts inside alone", () => {
  const r = ringTail(old, ts, ring(75_000, 110_000, 9), W, "1h");
  assert.deepEqual(r, [1, 1, 1, 9, 1]);
});

test("ringTail never touches 24h or 7d", () => {
  assert.deepEqual(ringTail(old, ts, ring(60_000, 110_000, 9), W, "24h"), old);
  assert.deepEqual(ringTail(old, ts, ring(60_000, 110_000, 9), W, "7d"), old);
});

test("ringTail with an empty ring returns the values unchanged", () => {
  assert.deepEqual(ringTail(old, ts, [], W, "1h"), old);
});

test("adoptPick: auto mode with fewer than 4 auto ids appends the ticked id", () => {
  assert.deepEqual(adoptPick(["a", "b"], [], "x"), ["a", "b", "x"]);
});

test("rangeAvgs keeps only containers in the current list: a gone name with the top avg is never ranked", () => {
  const summary = { gone: { avg: 90 }, a: { avg: 5 }, b: { avg: 2 } };
  const avgs = rangeAvgs(summary, ["a", "b", "new"]);
  assert.deepEqual([...avgs.keys()], ["a", "b"]);
  assert.deepEqual(topIds(holdNearTies([], avgs), 4), ["a", "b"]);
});

test("sparkMode: under 2 readings is a dot (or empty), never a line across the width", () => {
  assert.equal(sparkMode([]), "empty");
  assert.equal(sparkMode([null, null]), "empty");
  assert.equal(sparkMode([null, null, 0.4]), "dot");
  assert.equal(sparkMode([0.2, null, 0.4]), "line");
  assert.equal(sparkMode([0, 0]), "line");
});

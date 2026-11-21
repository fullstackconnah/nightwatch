import test from "node:test";
import assert from "node:assert/strict";
import { seriesFor, finiteMean, finitePeak, gapPaths } from "./chart-points.ts";

const row = (cpuPct: number) => ({ cpuPct, memBytes: 0, memLimit: 0, rxRate: 0, txRate: 0, blkReadRate: 0, blkWriteRate: 0, pids: 0 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sample = (ts: number, c?: number): any => ({ ts, containers: c === undefined ? {} : { a: row(c) } });
const NaNs = (a: number[]) => a.map((v) => Number.isNaN(v));
const subpaths = (d: string) => (d.match(/M/g) ?? []).length;

test("seriesFor: an absent row is NaN, a real 0 stays 0", () => {
  const s = seriesFor([sample(1), sample(2, 0), sample(3, 5)], "a", "cpu");
  assert.deepEqual(NaNs(s), [true, false, false]);
  assert.equal(s[1], 0);
  assert.equal(s[2], 5);
});

test("seriesFor: a non-finite metric is NaN", () => {
  assert.ok(Number.isNaN(seriesFor([sample(1, Infinity)], "a", "cpu")[0]));
});

test("finiteMean: gap at the start (3 absent then 2 real) equals the mean of the 2", () => {
  assert.equal(finiteMean([NaN, NaN, NaN, 2, 4]), 3);
});

test("finiteMean: a real 0 counts; no finite sample has no mean", () => {
  assert.equal(finiteMean([0, 4, NaN]), 2);
  assert.equal(finiteMean([NaN, NaN]), null);
  assert.equal(finiteMean([]), null);
});

test("finitePeak: skips gaps, never NaN", () => {
  assert.equal(finitePeak([NaN, 3, NaN, 7]), 7);
  assert.equal(finitePeak([NaN]), 0);
});

test("gapPaths: all real is one sub-path", () => {
  const p = gapPaths([1, 2, 3], 20, 10, 4)!;
  assert.equal(subpaths(p.line), 1);
});

test("gapPaths: a gap in the middle makes two sub-paths, none at the baseline, x stays indexed", () => {
  const p = gapPaths([2, 2, NaN, NaN, 2, 2], 50, 10, 4)!;
  assert.equal(subpaths(p.line), 2);
  assert.equal(subpaths(p.area), 2);
  assert.ok(!/NaN/.test(p.line + p.area));
  assert.ok(!p.line.includes(",10")); // y=height only for a real 0
  assert.match(p.line, /^M0,5 L10,5 M40,5 L50,5$/);
});

test("gapPaths: a gap at the start begins at the first real index", () => {
  const p = gapPaths([NaN, NaN, NaN, 2, 4], 40, 10, 4)!;
  assert.match(p.line, /^M30,5 L40,0$/);
});

test("gapPaths: a lone real point between gaps is a zero-length segment", () => {
  const p = gapPaths([1, NaN, 1, NaN, 1], 40, 10, 2)!;
  assert.equal(p.line, "M0,5 L0,5 M20,5 L20,5 M40,5 L40,5");
});

test("gapPaths: a single sample draws flat full width; a real 0 sits on the baseline", () => {
  assert.equal(gapPaths([3], 20, 10, 3)!.line, "M0,0 L20,0");
  assert.match(gapPaths([0, 0], 20, 10, 4)!.line, /^M0,10 L20,10$/);
});

test("gapPaths: no finite sample is null", () => {
  assert.equal(gapPaths([NaN, NaN], 20, 10, 1), null);
  assert.equal(gapPaths([], 20, 10, 1), null);
});

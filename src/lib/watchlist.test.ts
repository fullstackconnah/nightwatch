import test from "node:test";
import assert from "node:assert/strict";
import {
  CPU_STEPS,
  MEM_STEPS,
  snapScale,
  cpuBand,
  memBand,
  createRanker,
  splitWatch,
  quietCap,
  legendEntries,
  watchCpuText,
  listHeld,
  type WatchItem,
} from "./watchlist.ts";

test("snapScale rounds up to the next step and keeps a value equal to a step", () => {
  assert.equal(snapScale(0.3, CPU_STEPS), 1);
  assert.equal(snapScale(1, CPU_STEPS), 1);
  assert.equal(snapScale(1.01, CPU_STEPS), 2);
  assert.equal(snapScale(5, CPU_STEPS), 5);
  assert.equal(snapScale(5.1, CPU_STEPS), 10);
  assert.equal(snapScale(99, CPU_STEPS), 100);
});

test("snapScale clamps values over the top step to the top step", () => {
  assert.equal(snapScale(250, CPU_STEPS), 100);
  const top = MEM_STEPS[MEM_STEPS.length - 1];
  assert.equal(snapScale(top * 3, MEM_STEPS), top);
});

test("snapScale on memory steps", () => {
  assert.equal(snapScale(300 * 1024 ** 2, MEM_STEPS), 512 * 1024 ** 2);
  assert.equal(snapScale(1024 ** 3, MEM_STEPS), 1024 ** 3);
});

test("cpuBand parts sum to the base and host & other is the remainder", () => {
  const b = cpuBand(20.1, [1.5, 1.4]);
  assert.equal(b.base, 100);
  assert.ok(Math.abs(b.parts[0] - 2.9) < 1e-9);
  assert.ok(Math.abs(b.parts[1] - 17.2) < 1e-9);
  assert.ok(Math.abs(b.parts.reduce((a, v) => a + v, 0) - b.base) < 0.5);
});

test("cpuBand clamps host & other at 0 when containers exceed the host", () => {
  const b = cpuBand(5, [4, 4]);
  assert.equal(b.parts[1], 0);
  assert.ok(Math.abs(b.parts.reduce((a, v) => a + v, 0) - b.base) < 0.5);
});

test("memBand parts sum to the total; clamps when containers exceed used", () => {
  const GiB = 1024 ** 3;
  const b = memBand(8 * GiB, 16 * GiB, [2 * GiB, GiB]);
  assert.equal(b.base, 16 * GiB);
  assert.equal(b.parts[0], 3 * GiB);
  assert.equal(b.parts[1], 5 * GiB);
  assert.equal(b.parts[2], 8 * GiB);
  const c = memBand(2 * GiB, 16 * GiB, [3 * GiB]);
  assert.equal(c.parts[1], 0);
  assert.ok(Math.abs(c.parts.reduce((a, v) => a + v, 0) - c.base) < 0.5);
});

test("bands never go negative or NaN on bad input", () => {
  for (const b of [cpuBand(NaN, [NaN, 1]), memBand(NaN, 0, [NaN]), cpuBand(150, [])]) {
    for (const p of b.parts) assert.ok(Number.isFinite(p) && p >= 0);
  }
});

test("ranker: the first offer always commits, even while held", () => {
  const r = createRanker();
  assert.equal(r.offer(["a", "b"], 0, true), true);
  assert.deepEqual(r.order, ["a", "b"]);
  assert.equal(r.pending, false);
});

test("ranker: no commit within 4000 ms, then a commit at 4000", () => {
  const r = createRanker();
  r.offer(["a", "b"], 1000, false);
  assert.equal(r.offer(["b", "a"], 4999, false), false);
  assert.deepEqual(r.order, ["a", "b"]);
  assert.equal(r.pending, true);
  assert.equal(r.offer(["b", "a"], 5000, false), true);
  assert.deepEqual(r.order, ["b", "a"]);
  assert.equal(r.pending, false);
});

test("ranker: no commit while held, whatever the time, and pending is set", () => {
  const r = createRanker();
  r.offer(["a", "b"], 0, false);
  assert.equal(r.offer(["b", "a"], 1e9, true), false);
  assert.equal(r.pending, true);
  assert.deepEqual(r.order, ["a", "b"]);
  assert.equal(r.offer(["a", "b"], 1e9 + 1, true), false);
  assert.equal(r.pending, false, "same order again clears pending");
});

const item = (id: string, value: number | null, running = true): WatchItem => ({ id, name: id, running, value });

test("cpu split: 0.049 is quiet, 0.05 is watch", () => {
  const s = splitWatch([item("a", 0.049), item("b", 0.05)], "cpu");
  assert.deepEqual(s.watch, ["b"]);
  assert.deepEqual(s.quiet, ["a"]);
});

test("cpu split: at most 10 in watch, busiest first, the rest fold into quiet by name", () => {
  const items = Array.from({ length: 12 }, (_, i) => item(`c${String(i).padStart(2, "0")}`, 1 + i));
  const s = splitWatch(items, "cpu");
  assert.equal(s.watch.length, 10);
  assert.equal(s.watch[0], "c11");
  assert.deepEqual(s.quiet, ["c00", "c01"]);
});

test("mem split: watch is the top 10 by bytes, even tiny ones", () => {
  const items = Array.from({ length: 11 }, (_, i) => item(`m${i}`, (i + 1) * 100));
  const s = splitWatch(items, "mem");
  assert.equal(s.watch.length, 10);
  assert.equal(s.watch[0], "m10");
  assert.deepEqual(s.quiet, ["m0"]);
});

test("split: stopped, or running with no telemetry row, goes to the stopped fold; measured zero is quiet", () => {
  const s = splitWatch(
    [item("z-stopped", 0, false), item("a-norow", null), item("zero", 0), item("busy", 3)],
    "cpu",
  );
  assert.deepEqual(s.stopped, ["a-norow", "z-stopped"]);
  assert.deepEqual(s.quiet, ["zero"]);
  assert.deepEqual(s.watch, ["busy"]);
});

test("quietCap: the smallest step strictly above the quiet maximum", () => {
  assert.equal(quietCap("cpu", 0.03), 0.05);
  assert.equal(quietCap("cpu", 0.05), 0.1);
  assert.equal(quietCap("cpu", 0.7), 1);
  assert.equal(quietCap("mem", 0), 16 * 1024 ** 2);
  assert.equal(quietCap("mem", 40 * 1024 ** 2), 64 * 1024 ** 2);
  assert.equal(quietCap("mem", 5 * 1024 ** 3), 1024 ** 3, "clamps to the top step");
});

test("legendEntries: a series with no samples is flagged noData, one with a sample is not", () => {
  const out = legendEntries([
    { key: "host", label: "box", points: [1, null] },
    { key: "a", label: "a", points: [null, null] },
    { key: "b", label: "b", points: [] },
  ]);
  assert.deepEqual(
    out.map((e) => [e.key, e.noData]),
    [["host", false], ["a", true], ["b", true]],
  );
});

test("watchCpuText: one precision (2 dp) for every cpu figure, so rows line up", () => {
  assert.equal(watchCpuText(1.2), "1.20%");
  assert.equal(watchCpuText(0.85), "0.85%");
  assert.equal(watchCpuText(0.05), "0.05%");
  assert.equal(watchCpuText(12), "12.00%");
});

test("listHeld: hover, focus, an open row or a stale feed each hold the order", () => {
  const off = { hover: false, focusIn: false, openId: null, stale: false };
  assert.equal(listHeld(off), false);
  for (const k of ["hover", "focusIn", "stale"] as const) assert.equal(listHeld({ ...off, [k]: true }), true, k);
  assert.equal(listHeld({ ...off, openId: "c1" }), true);
});

test("listHeld reaches the ranker: while held a new order waits and pending is set", () => {
  const r = createRanker();
  r.offer(["a", "b"], 0, false);
  assert.equal(r.offer(["b", "a"], 10_000, listHeld({ hover: false, focusIn: false, openId: null, stale: true })), false);
  assert.equal(r.pending, true);
  assert.deepEqual([...(r.order ?? [])], ["a", "b"]);
});

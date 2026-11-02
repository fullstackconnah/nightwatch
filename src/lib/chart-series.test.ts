import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERIES_SLOTS, assignSlots, layoutEndLabels } from "./chart-series.ts";

test("5 slots, each a distinct (colour, dash) pair", () => {
  assert.equal(SERIES_SLOTS.length, 5);
  const keys = new Set(SERIES_SLOTS.map((s) => `${s.stroke}|${s.dash ?? ""}`));
  assert.equal(keys.size, 5);
});

test("assignSlots hands out slots in pick order", () => {
  const m = assignSlots(["a", "b", "c"], new Map(), 1);
  assert.deepEqual([m.get("a"), m.get("b"), m.get("c")], [1, 2, 3]);
});

test("removing a middle compare keeps the others' slots, and a new pick takes the gap", () => {
  const before = assignSlots(["a", "b", "c"], new Map(), 1);
  const after = assignSlots(["a", "c"], before, 1);
  assert.equal(after.get("a"), 1);
  assert.equal(after.get("c"), 3);
  const added = assignSlots(["a", "c", "d"], after, 1);
  assert.equal(added.get("d"), 2);
});

test("no ramp hex literal in the chart files", () => {
  for (const f of ["./chart-series.ts", "../components/resources/resource-overview.tsx", "../components/resources/net-compare.tsx", "../components/resources/disk-growth.tsx"]) {
    const text = readFileSync(new URL(f, import.meta.url), "utf8");
    for (const hex of ["#0f766e", "#0d9488", "#14b8a6", "#134e4a"]) assert.ok(!text.includes(hex), `${f} has ${hex}`);
  }
});

const inRange = (ys: number[], H: number) => ys.every((y) => y >= 6 && y <= H - 6);

test("layoutEndLabels: labels piled at the floor come out distinct, gap apart and in range", () => {
  const H = 140;
  const out = layoutEndLabels([10, 134, 134, 134, 134], H, 14);
  assert.ok(inRange(out, H));
  const sorted = [...out].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 14 - 1e-9);
  assert.equal(out[0], 10);
});

test("layoutEndLabels: labels already apart do not move", () => {
  assert.deepEqual(layoutEndLabels([20, 60, 100], 140, 14), [20, 60, 100]);
});

test("layoutEndLabels: too many for the height spread evenly and stay in range", () => {
  const H = 60;
  const out = layoutEndLabels([30, 30, 30, 30, 30, 30, 30, 30], H, 14);
  assert.ok(inRange(out, H));
  const step = (H - 12) / 7;
  out.forEach((y, i) => assert.ok(Math.abs(y - (6 + i * step)) < 1e-9));
});

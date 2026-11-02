import test from "node:test";
import assert from "node:assert/strict";
import { CPU_STEPS, MEM_STEPS, snapScale, cpuBand, memBand } from "./watchlist.ts";

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

import test from "node:test";
import assert from "node:assert/strict";
import { containerCpuShare, processCpuShare } from "./cpu-share.ts";

test("container: one busy core of 12 is ~8.3 of the box", () => {
  // system_cpu_usage spans all cores: over a window of 12 core-seconds, 1 core-second used
  assert.ok(Math.abs(containerCpuShare(1e9, 12e9) - 8.333) < 0.01);
});
test("container: all cores busy is 100", () => {
  assert.equal(containerCpuShare(12e9, 12e9), 100);
});
test("container: zero system delta is 0", () => {
  assert.equal(containerCpuShare(5, 0), 0);
});
test("container: negative and overflow are clamped", () => {
  assert.equal(containerCpuShare(-5, 100), 0);
  assert.equal(containerCpuShare(500, 100), 100);
});

test("process: one busy core of 12 is ~8.3", () => {
  // 100 ticks (CLK_TCK 100) over 1000ms = one full core
  assert.ok(Math.abs(processCpuShare(100, 100, 1000, 12) - 8.333) < 0.01);
});
test("process: all cores busy is 100, overflow clamped", () => {
  assert.equal(processCpuShare(1200, 100, 1000, 12), 100);
  assert.equal(processCpuShare(5000, 100, 1000, 12), 100);
});
test("process: bad inputs give 0", () => {
  assert.equal(processCpuShare(-1, 100, 1000, 12), 0);
  assert.equal(processCpuShare(50, 100, 0, 12), 0);
  assert.equal(processCpuShare(50, 100, 1000, 0), 0);
});

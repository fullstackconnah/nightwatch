import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bucketWidthMs, mean, shouldSkipTick } from "./metrics-history-math.ts";
import { brightnessPercent } from "./ha-brightness.ts";

const INTERVAL = 30_000;

test("shouldSkipTick: skips inside the interval, writes after it and when the clock went backwards", () => {
  assert.equal(shouldSkipTick(10_010_000, 10_000_000, INTERVAL), true);
  assert.equal(shouldSkipTick(10_030_000, 10_000_000, INTERVAL), false);
  assert.equal(shouldSkipTick(5_000_000, 10_000_000, INTERVAL), false);
});

test("bucketWidthMs: 1h is 2x the sample interval, wider ranges are unchanged", () => {
  assert.equal(bucketWidthMs(3_600_000, INTERVAL, 360), 60_000);
  assert.equal(bucketWidthMs(24 * 3_600_000, INTERVAL, 360), 240_000);
  assert.equal(bucketWidthMs(7 * 24 * 3_600_000, INTERVAL, 360), 1_680_000);
});

test("mean: skips null and non-finite values; no valid value is a gap", () => {
  assert.equal(mean([10, null, 30]), 20);
  assert.equal(mean([null]), null);
  assert.equal(mean([Number.NaN, 4]), 4);
  assert.equal(mean([]), null);
});

test("brightnessPercent: at least 1% while on, 100 at full, null when off or missing", () => {
  assert.equal(brightnessPercent(true, 1), 1);
  assert.equal(brightnessPercent(true, 255), 100);
  assert.equal(brightnessPercent(true, 0), 0);
  assert.equal(brightnessPercent(false, 128), null);
  assert.equal(brightnessPercent(true, null), null);
});

const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

test("wiring: ha.ts knows open and opening; history uses the helpers", () => {
  const ha = src("./ha.ts");
  assert.match(ha, /^\s+"open",$/m);
  assert.match(ha, /^\s+"opening",$/m);
  assert.match(ha, /brightnessPercent\(on, brightnessRaw\)/);
  const h = src("./metrics-history.ts");
  assert.match(h, /if \(shouldSkipTick\(input\.ts, last, SAMPLE_INTERVAL_MS\)\) return;/);
  assert.match(h, /bucketWidth\(rangeMs, SAMPLE_INTERVAL_MS, MAX_POINTS\)/);
  assert.match(h, /^\s+cpu: Number\.isFinite\(input\.host\.cpuPct\) \? /m);
});

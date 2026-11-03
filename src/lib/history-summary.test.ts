import test from "node:test";
import assert from "node:assert/strict";
import { summarizeContainers, attachSummary, parseSummary, type SummarySample } from "./history-summary.ts";

const W = 60_000;
// 4 samples: two in bucket 0 (t 0, 30k), none in bucket 1, one in bucket 2 (120k), one in bucket 3 (180k)
const S: SummarySample[] = [
  { t: 0, cpu: 10, memUsed: 100, containers: { a: [2, 10, 0, 0], b: [4, 20, 0, 0] } },
  { t: 30_000, cpu: 20, memUsed: 200, containers: { a: [4, 30, 0, 0] } },
  { t: 120_000, cpu: 30, memUsed: 300, containers: { a: [6, 50, 0, 0], b: [0, 0, 0, 0] } },
  { t: 180_000, cpu: 40, memUsed: 400, containers: {} },
];

test("containersTotal sums every container per epoch-aligned bucket, empty bucket is null", () => {
  const r = summarizeContainers(S, 0, 180_000, W, "cpu", 48);
  assert.deepEqual(r.containersTotal, [(2 + 4 + 4) / 2, null, 6, 0]);
});

test("mem metric reads tuple index 1", () => {
  const r = summarizeContainers(S, 0, 180_000, W, "mem", 48);
  assert.deepEqual(r.containersTotal, [(30 + 30) / 2, null, 50, 0]);
});

test("avg and peak per name over the window (present samples only)", () => {
  const r = summarizeContainers(S, 0, 180_000, W, "cpu", 48);
  assert.equal(r.summary.a.avg, 4);
  assert.equal(r.summary.a.peak, 6);
  assert.equal(r.summary.b.avg, 2);
  assert.equal(r.summary.b.peak, 4);
});

test("spark has 48 points, empty bins are null and never 0", () => {
  const r = summarizeContainers(S, 0, 180_000, W, "cpu", 48);
  assert.equal(r.summary.a.spark.length, 48);
  assert.equal(r.summary.a.spark[0], 2); // bin width 3750 ms: t 0 is bin 0, 30k is bin 8, 120k is bin 32
  assert.equal(r.summary.a.spark[8], 4);
  assert.equal(r.summary.a.spark[47], null); // t=180k has no a
  assert.equal(r.summary.a.spark.filter((v) => v === null).length, 45);
  assert.ok(r.summary.a.spark.every((v) => v === null || v > 0));
  assert.equal(r.summary.b.spark.filter((v) => v === 0).length, 1); // a real 0 reading stays 0
});

test("samples outside the window are ignored", () => {
  const r = summarizeContainers(S, 100_000, 180_000, W, "cpu", 48);
  assert.equal(r.summary.a.peak, 6);
  assert.equal(r.summary.b.avg, 0);
});

test("without summary the keys are exactly recordingSince, host, containers", () => {
  const base = { recordingSince: 1, host: [], containers: {} };
  assert.deepEqual(Object.keys(attachSummary(base, S, 0, 180_000, W, undefined)), ["recordingSince", "host", "containers"]);
  const withIt = attachSummary(base, S, 0, 180_000, W, "cpu");
  assert.deepEqual(Object.keys(withIt), ["recordingSince", "host", "containers", "containersTotal", "summary"]);
});

test("parseSummary accepts cpu and mem, ignores anything else", () => {
  assert.equal(parseSummary("cpu"), "cpu");
  assert.equal(parseSummary("mem"), "mem");
  for (const v of [null, "", "disk", "CPU", "cpu,mem"]) assert.equal(parseSummary(v), undefined);
});

test("no samples: containersTotal is all null and summary is empty", () => {
  const r = summarizeContainers([], 0, 180_000, W, "cpu", 48);
  assert.deepEqual(r.containersTotal, [null, null, null, null]);
  assert.deepEqual(r.summary, {});
});

test("one sample: avg equals peak and only its spark bin is filled", () => {
  const r = summarizeContainers([S[0]], 0, 180_000, W, "cpu", 48);
  assert.equal(r.summary.a.avg, 2);
  assert.equal(r.summary.a.peak, 2);
  assert.equal(r.summary.a.spark.filter((v) => v != null).length, 1);
});

test("startTs === endTs: no NaN spark index, a sample at that instant lands in bin 0", () => {
  const one: SummarySample[] = [{ t: 5000, cpu: 1, memUsed: 1, containers: { a: [3, 9, 0, 0] } }];
  const r = summarizeContainers(one, 5000, 5000, W, "cpu", 48);
  assert.equal(r.summary.a.spark[0], 3);
  assert.equal(r.summary.a.spark.filter((v) => v != null).length, 1);
  assert.deepEqual(r.containersTotal, [3]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  sumHostNetCounters,
  statfsUsage,
  maxThermalC,
  isPartitionName,
} from "./host-metrics-pure.ts";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const hostMetrics = src("./host-metrics.ts");

const NET = [
  "Inter-|   Receive",
  " face |bytes    packets",
  "    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0",
  "  eth0: 100 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0",
  "veth1a: 5000 1 0 0 0 0 0 0 6000 1 0 0 0 0 0 0",
  "docker0: 7000 1 0 0 0 0 0 0 8000 1 0 0 0 0 0 0",
  "br-abc: 9000 1 0 0 0 0 0 0 9100 1 0 0 0 0 0 0",
  "virbr0: 300 1 0 0 0 0 0 0 400 1 0 0 0 0 0 0",
].join("\n");

// F1
test("sumHostNetCounters skips lo, veth, docker and bridge interfaces", () => {
  assert.deepEqual(sumHostNetCounters(NET), { rxBytes: 100, txBytes: 200 });
});
test("sumHostNetCounters returns null when no interface is left", () => {
  assert.equal(sumHostNetCounters(NET.split("\n").slice(0, 3).join("\n")), null);
});
test("readHostNetDev and hostProcAvailable read the pid 1 namespace", () => {
  assert.match(hostMetrics, /^\s+return fs\.existsSync\(`\$\{HOST_PROC\}\/1\/net\/dev`\);$/m);
  assert.match(hostMetrics, /^\s+const content = fs\.readFileSync\(`\$\{HOST_PROC\}\/1\/net\/dev`, "utf8"\);$/m);
  assert.doesNotMatch(hostMetrics, /\$\{HOST_PROC\}\/net\/dev/);
});

// F2
test("telemetry takes the read time before Promise.all and uses it for host rates", () => {
  const t = src("./telemetry.ts");
  const readAt = t.indexOf("const readAt = performance.now()");
  assert.ok(readAt > 0 && readAt < t.indexOf("await Promise.all"));
  assert.match(t, /^\s+const hostElapsedSeconds = /m);
  assert.match(t, /rate\(readSum, globalForTelemetry\.__telemetryPrevDiskRead, hostElapsedSeconds\)/);
  assert.match(t, /rate\(netCounters\.rxBytes, globalForTelemetry\.__telemetryPrevNetRx, hostElapsedSeconds\)/);
});

// F3
test("statfsUsage matches df on a 5% reserve disk with no files", () => {
  const bsize = 4096;
  const blocks = 1000;
  const r = statfsUsage({ blocks, bfree: 1000, bavail: 950, bsize });
  assert.equal(r.total, blocks * bsize);
  assert.equal(r.used, 0);
  assert.equal(r.percent, 0);
});
test("statfsUsage percent is used over used plus avail", () => {
  const r = statfsUsage({ blocks: 1000, bfree: 500, bavail: 450, bsize: 1 });
  assert.equal(r.used, 500);
  assert.equal(r.percent, (500 / 950) * 100);
});
test("statfsUsage guards a zero-size filesystem", () => {
  assert.equal(statfsUsage({ blocks: 0, bfree: 0, bavail: 0, bsize: 4096 }).percent, 0);
});

// F4
test("maxThermalC skips a throwing read, bogus values and non-finite values", () => {
  const reads = [
    () => 45000,
    () => {
      throw new Error("EINVAL");
    },
    () => 255000,
    () => NaN,
    () => 61000,
    () => 500,
  ];
  assert.equal(maxThermalC(reads), 61);
  assert.equal(maxThermalC([() => 255000]), null);
});

// F9
test("isPartitionName uses suffix forms only", () => {
  for (const d of ["nvme0n1", "nvme0n10", "sda", "mmcblk1", "mmcblk10", "vda", "xvda", "hda"]) {
    assert.equal(isPartitionName(d), false, d);
  }
  for (const p of ["nvme0n1p1", "nvme0n10p2", "sda1", "sda12", "mmcblk1p1", "vda1", "xvda2", "hda3"]) {
    assert.equal(isPartitionName(p), true, p);
  }
});

// F7
test("runDu collects Buffer chunks and decodes once", () => {
  const d = src("./disk-usage.ts");
  assert.match(d, /Buffer\.concat\(chunks\)\.toString\("utf8"\)/);
  assert.doesNotMatch(d, /stdout \+= d\.toString/);
});

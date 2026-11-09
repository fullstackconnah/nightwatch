import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { capCmdline, redactCmdline } from "./redact.ts";
import { capConnections, isCacheableGpuReason, CONNECTIONS_MAX } from "./server-cost.ts";
import { kioskVitals } from "./kiosk-vitals-view.ts";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

describe("hunt 22 server cost", () => {
  it("capCmdline cuts at 2048 after redaction", () => {
    const long = "java " + "x".repeat(5000);
    assert.equal(capCmdline(long).length, 2048);
    assert.equal(capCmdline("short"), "short");
    const redacted = redactCmdline("curl -u bob:hunter2 http://h/ " + "y".repeat(3000));
    assert.ok(!capCmdline(redacted).includes("hunter2"));
  });

  it("capConnections keeps the top N and counts the dropped rows", () => {
    const rows = Array.from({ length: CONNECTIONS_MAX + 5 }, (_, i) => ({ count: 1000 - i }));
    const out = capConnections(rows);
    assert.equal(out.connections.length, CONNECTIONS_MAX);
    assert.equal(out.truncated, 5);
    assert.equal(out.connections[0].count, 1000);
    const small = capConnections(rows.slice(0, 3));
    assert.equal(small.truncated, 0);
    assert.equal(small.connections.length, 3);
  });

  it("only stable gpu reasons are cached as unavailable", () => {
    for (const r of ["no-binary", "driver-mismatch", "no-device"] as const) assert.equal(isCacheableGpuReason(r), true);
    assert.equal(isCacheableGpuReason("error"), false);
  });

  it("kioskVitals carries no mount path, hostname, os or cpu model", () => {
    const out = kioskVitals({
      hostname: "box",
      os: "linux",
      uptimeSeconds: 5,
      cpu: { percent: 3, cores: 4, model: "CPU X", loadAvg: [1, 1, 1] },
      memory: { total: 10, used: 4, available: 6, percent: 40 },
      disk: [{ mount: "/mnt/secret", total: 100, used: 50, percent: 50, mounts: ["/mnt/secret", "/mnt/b"] }],
      network: { rxPerSec: 1, txPerSec: 2 },
      tempC: 40,
      ts: 7,
    });
    const json = JSON.stringify(out);
    for (const bad of ["mount", "hostname", "box", "/mnt", "CPU X", "linux"]) assert.ok(!json.includes(bad), bad);
    assert.deepEqual(out.disk, [{ total: 100, used: 50, percent: 50 }]);
    assert.equal(out.cpu.percent, 3);
    assert.equal(out.memory.used, 4);
    assert.equal(out.ts, 7);
  });

  it("process and network snapshots go through Memo", () => {
    assert.match(read("./processes.ts"), /^const processSnapshotMemo = new Memo<ProcessSnapshot>\(/m);
    assert.match(read("./processes.ts"), /^export function getProcessSnapshot\(\)/m);
    assert.match(read("./network.ts"), /^const networkSnapshotMemo = new Memo<NetworkSnapshot>\(/m);
    assert.match(read("./network.ts"), /^export function getNetworkSnapshot\(\)/m);
  });

  it("telemetry wraps the gpu call in withTimeout", () => {
    assert.match(read("./telemetry.ts"), /^\s+withTimeout\(getGpuSnapshot\(\), TELEMETRY_CALL_MS, \(\) => null\)/m);
  });

  it("gpu caches only stable reasons", () => {
    assert.match(read("./gpu.ts"), /^\s+if \(isCacheableGpuReason\(result\.reason\)\) globalForGpu\.__gpuUnavailableCache/m);
  });

  it("assistant route checks content-length before req.json", () => {
    const src = read("../app/kiosk/api/assistant/route.ts");
    const len = src.search(/^\s+const declared = Number\(req\.headers\.get\("content-length"\)\)/m);
    const json = src.search(/^\s+const raw = await req\.json\(\)/m);
    assert.ok(len > 0 && json > len);
  });

  it("kiosk vitals route projects through kioskVitals", () => {
    assert.match(read("../app/kiosk/api/vitals/route.ts"), /^\s+\{ collect: async \(\) => kioskVitals\(await getHostVitals\(\)\)/m);
  });

  it("no raw error text reaches a response field in network.ts or processes.ts", () => {
    const net = read("./network.ts");
    assert.doesNotMatch(net, /warnings(\.push\(|: \[\.\.\.warnings, )[^\n]*\$\{errMsg\(err\)\}/);
    assert.doesNotMatch(net, /warnings: \[\.\.\.warnings, errMsg\(err\)\]/);
    assert.doesNotMatch(read("./processes.ts"), /error: err instanceof Error \? err\.message/);
  });
});

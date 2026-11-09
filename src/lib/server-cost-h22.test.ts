import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { capCmdline, redactCmdline } from "./redact.ts";
import { capConnections, CONNECTIONS_MAX } from "./server-cost.ts";
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
    assert.equal(out.truncatedConnections, 800 + 799 + 798 + 797 + 796);
  });

  it("capConnections edges: empty, exactly the cap, one over", () => {
    assert.deepEqual(capConnections([]), { connections: [], truncated: 0, truncatedConnections: 0 });
    const at = capConnections(Array.from({ length: CONNECTIONS_MAX }, () => ({ count: 2 })));
    assert.equal(at.truncated, 0);
    assert.equal(at.truncatedConnections, 0);
    const over = capConnections([...Array.from({ length: CONNECTIONS_MAX }, () => ({ count: 2 })), { count: 7 }]);
    assert.equal(over.truncated, 1);
    assert.equal(over.truncatedConnections, 7);
  });

  it("connections header uses the true totals and names the dropped remotes", () => {
    const src = read("../components/resources/net-connections.tsx");
    assert.ok(src.includes("const totalConns = connections.reduce((a, g) => a + g.count, 0) + truncatedConnections;"));
    assert.ok(src.includes("const totalRemotes = connections.length + truncated;"));
    assert.ok(src.includes('quieter {truncated === 1 ? "remote" : "remotes"} not shown'));
    assert.ok(read("../app/(dash)/networks/page.tsx").includes("truncated={snapshot.truncated} truncatedConnections={snapshot.truncatedConnections}"));
  });

  it("order: cmdline is redacted before the 2048 cut", () => {
    assert.ok(read("./processes.ts").includes("capCmdline(redactCmdline(cleaned))"));
    const secretNearEnd = "curl -u bob:hunter2 http://h/" + "y".repeat(2040);
    assert.ok(!capCmdline(redactCmdline("x".repeat(2000) + " " + secretNearEnd)).includes("hunter2"));
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

  it("gpu caches the error reason with a short backoff", () => {
    const src = read("./gpu.ts");
    assert.match(src, /^const UNAVAILABLE_ERROR_BACKOFF_MS = 10_000;/m);
    assert.ok(src.includes('cached.reason === "error" ? UNAVAILABLE_ERROR_BACKOFF_MS : UNAVAILABLE_BACKOFF_MS'));
    assert.doesNotMatch(src, /isCacheableGpuReason/);
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

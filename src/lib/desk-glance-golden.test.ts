import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGlance } from "./desk-glance.ts";
import type { AttentionHit, AttentionReport, ProbeStatus } from "./attention-report.ts";

// The C# Core tests parse the committed fixture; this keeps it equal to what the server builds.
const hit = (probe: AttentionHit["probe"], subject: string, over: Partial<AttentionHit>): AttentionHit => ({
  id: `${probe}:${subject}`,
  probe,
  subject,
  severity: "warn",
  headline: "x",
  firstSeen: "2026-01-01T00:00:00.000Z",
  owner: { href: "/resources", label: "x" },
  ...over,
});
const probes: ProbeStatus[] = [
  { id: "crashes", label: "Crashes", state: "answered", hits: 0 },
  { id: "smart", label: "SMART", state: "answered", hits: 0 },
  { id: "backup", label: "Backup", state: "answered", hits: 1 },
  { id: "disks", label: "Disks", state: "answered", hits: 1 },
  { id: "mounts", label: "Mounts", state: "failed", error: "/var/run/fake.sock" },
  { id: "health", label: "Health", state: "pending" },
  { id: "orchestra", label: "Orchestra", state: "answered", hits: 1 },
];
const report: AttentionReport = {
  checkedAt: "2026-01-01T14:05:30.000Z",
  probes,
  hits: [
    hit("disks", "disk:/data", {
      id: "disks:/data",
      severity: "bad",
      headline: "Disk /data is almost full",
      detail: "97% used",
      action: "Free some space",
      since: "2026-01-01T13:00:00.000Z",
      owner: { href: "/resources?metric=disk", label: "Disks" },
    }),
    hit("backup", "backup", { headline: "Backup is late", owner: { href: "#backup", label: "Backup" } }),
    hit("orchestra", "orchestra", {
      id: "orchestra:orchestra",
      headline: "dev-lead is waiting for you",
      detail: "Usually a permission prompt",
      owner: { href: "/orchestrators", label: "Orchestrators" },
    }),
  ],
  changes: { since: "x", status: "answered", events: [], loggedFrom: null },
};
const vitals = {
  cpu: { percent: 12 },
  memory: { total: 1, used: 1, percent: 34 },
  disk: [{ total: 1, used: 1, percent: 50 }, { total: 1, used: 1, percent: 71 }],
  network: { rxPerSec: 0, txPerSec: 0 },
  ts: 1,
};

const weather = { tempC: 21.4, feelsC: 19.9, label: "Partly cloudy", highC: 25, lowC: 14, rainPct: 60, icon: "partly-cloudy" };

test("the committed golden fixture equals buildGlance of the pinned input", () => {
  const file = JSON.parse(readFileSync(new URL("../../desk/Core.Tests/fixtures/glance.v1.json", import.meta.url), "utf8"));
  assert.deepEqual(file, JSON.parse(JSON.stringify(buildGlance(report, vitals, { weather, camera: true }))));
});

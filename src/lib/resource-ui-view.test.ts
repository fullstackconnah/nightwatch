import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  failedRunText,
  scanPollInterval,
  scanView,
  cappedMounts,
  moreMountsNote,
  fastestGrowing,
  SCAN_STATUS_LOST,
} from "./resource-ui-view.ts";

const job = (state: "running" | "done" | "error", root = "/a") => ({ state, root });

test("A1: failed-run text is redacted, empty keeps the fallback", () => {
  assert.ok(!failedRunText("boom password=hunter2").includes("hunter2"));
  assert.match(failedRunText(""), /no further detail/);
  assert.match(failedRunText(null), /no further detail/);
  const src = readFileSync(new URL("../components/integrations/hermes-actions.tsx", import.meta.url), "utf8");
  assert.match(src, /failedRunText\(job\.error\)/);
});

test("A2: poll fast only when running and no error", () => {
  assert.equal(scanPollInterval(job("running"), undefined), 800);
  assert.equal(scanPollInterval(job("running"), new Error("404")), 0);
  assert.equal(scanPollInterval(job("done"), undefined), 0);
  assert.equal(scanPollInterval(undefined, undefined), 0);
});

test("A2/A3: scanView", () => {
  assert.deepEqual(scanView(job("running"), new Error("x"), "/a"), { running: false, statusLost: true, showResults: false });
  assert.equal(scanView(job("running", "/a"), undefined, "/a").running, true);
  // A3: another root scanning does not hide this folder's button
  assert.equal(scanView(job("running", "/b"), undefined, "/a").running, false);
  assert.equal(SCAN_STATUS_LOST, "Scan status lost. Run the scan again.");
});

test("A5: charted mounts cap at 5 with a pinned note", () => {
  const m = ["a", "b", "c", "d", "e", "f", "g"];
  assert.deepEqual(cappedMounts(m), { shown: ["a", "b", "c", "d", "e"], dropped: 2 });
  assert.equal(cappedMounts(["a"]).dropped, 0);
  assert.equal(moreMountsNote(2), "+2 more mounts not shown");
  assert.equal(moreMountsNote(1), "+1 more mount not shown");
});

test("A4: shrinking mounts are never fastest growing", () => {
  const day = 86_400_000;
  const mk = (a: number, b: number) => [
    { t: 0, usedBytes: a },
    { t: 2 * day, usedBytes: b },
  ];
  assert.equal(fastestGrowing({ "/x": mk(100, 50), "/y": mk(100, 90) }), null);
  assert.equal(fastestGrowing({ "/x": mk(100, 50), "/y": mk(100, 300) })?.mount, "/y");
});

test("components are wired to the helpers", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const scan = read("../components/resources/disk-scan-jobs.tsx");
  assert.equal((scan.match(/scanView\(job, error, scanRoot\)/g) ?? []).length, 2);
  assert.equal((scan.match(/\{statusLost &&/g) ?? []).length, 2);
  assert.match(scan, /scanPollInterval\(latest, error\)/);
  const growth = read("../components/resources/disk-growth.tsx");
  assert.match(growth, /cappedMounts\(mountpoints\)/);
  assert.match(growth, /moreMountsNote\(dropped\)/);
});

test("H12: Hermes Ask renders the failed-run error through failedRunText", () => {
  const src = readFileSync(new URL("../components/integrations/hermes-ask.tsx", import.meta.url), "utf8");
  assert.match(src, /failedRunText\(job\.error\)/);
});

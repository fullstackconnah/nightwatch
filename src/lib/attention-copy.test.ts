import test from "node:test";
import assert from "node:assert/strict";
import {
  backupCheckStopped,
  backupDetail,
  containerCrashed,
  containerDown,
  containerUnhealthy,
  diskFull,
  doorbellQuietCopy,
  driveAlert,
  driveUnreadable,
  id,
  integrityAlert,
  keepsRestarting,
  place,
  stuckRestarting,
} from "./attention-copy.ts";

const A_FAIL = "Copy anything important off it now, then replace it.";

test("id clips a 25-character name to 24 ending in an ellipsis", () => {
  const out = id("a".repeat(25));
  assert.equal(out.length, 24);
  assert.ok(out.endsWith("…"));
  assert.equal(id("a".repeat(24)), "a".repeat(24));
});

test("place names the root disk and passes other mounts through", () => {
  assert.equal(place("/"), "the system disk");
  assert.equal(place("/mnt/media"), "/mnt/media");
});

// --- containers ---
test("C1 container down, with and without uptime", () => {
  assert.deepEqual(containerDown("web", "3h 12m"), {
    headline: "web is down",
    detail: "It stopped after 3h 12m and is stuck, so anything using it is unavailable.",
    action: "Restart it on the Containers page.",
  });
  assert.equal(containerDown("web", null).detail, "It stopped and is stuck, so anything using it is unavailable.");
});
test("C2 crashed: code 137 and any other code", () => {
  assert.deepEqual(containerCrashed("web", 137), {
    headline: "web crashed",
    detail: "It was force-stopped (code 137), often from running out of memory. It's down until restarted.",
    action: "Restart it on the Containers page; if it crashes again, check Logs.",
  });
  assert.equal(containerCrashed("web", 1).detail, "It stopped with an error (code 1) and is down until restarted.");
});
test("C3 stuck restarting", () => {
  assert.deepEqual(stuckRestarting("web", 7), {
    headline: "web is stuck restarting",
    detail: "It keeps crashing and starting again (7 restarts so far), so it isn't usable.",
    action: "Look for its error on the Logs page.",
  });
});
test("C4 keeps restarting", () => {
  const c = keepsRestarting("web", 2, 9);
  assert.equal(c.headline, "web keeps restarting");
  assert.equal(c.detail, "It crashed and started again 2 times since the last check (9 in all).");
  assert.equal(c.action, "Look for its error on the Logs page.");
  assert.equal(keepsRestarting("web", 1, 9).detail, "It crashed and started again 1 time since the last check (9 in all).");
});
test("U1 unhealthy", () => {
  assert.deepEqual(containerUnhealthy("web"), {
    headline: "web isn't working right",
    detail: "It's running but failing its own health check, so it may be slow or stuck.",
    action: "If it doesn't recover, restart it on the Containers page.",
  });
});

// --- drives (2b) ---
const drive = (reasons: string[]) => driveAlert("sda", reasons);
test("A1-A11 map their producer strings", () => {
  const fx: [string, string, string, string][] = [
    ["SMART overall self-assessment failed", "Drive sda is failing", "Its own health check says it's failing. Data on it is at risk.", A_FAIL],
    ["NVMe critical warning bitfield 0x4", "Drive sda has a fault", "It raised a critical warning (0x4). Data on it is at risk.", A_FAIL],
    ["3 media errors", "Drive sda is failing", "It couldn't read or write some data (3 errors). More usually follow.", A_FAIL],
    ["available spare 5% below threshold 10%", "Drive sda is worn out", "Its spare capacity is used up (5% left). It may fail soon.", A_FAIL],
    ["Reallocated_Sector_Ct failing now (pre-fail attribute at/below threshold)", "Drive sda is failing", "A key health reading (worn-out sectors it has replaced) has crossed its failure line.", A_FAIL],
    ["Composite at 80 °C, at/above critical", "Drive sda is overheating", "It's at 80 °C, at or above its safe limit.", "Check the server's fans and airflow now."],
    ["available spare 15% approaching threshold 10%", "Drive sda is wearing out", "Its spare capacity is running low (15% left).", "Plan to replace it, and keep its data backed up."],
    ["Reallocated_Sector_Ct failed its threshold previously", "Drive sda had a past fault", "A health reading (worn-out sectors it has replaced) failed once before.", "Keep its data backed up and watch it."],
    ["12 reallocated sector ct", "Drive sda is showing errors", "It has logged 12 worn-out sectors it has replaced, an early sign of wear.", "Plan to replace it, and keep its data backed up."],
    ["Temperature 70 °C, 5 °C from critical", "Drive sda is running hot", "It's at 70 °C, close to its safe limit.", "Check the server's fans and airflow."],
    ["wear at 85%", "Drive sda is wearing out", "It has used 85% of its rated life.", "Plan to replace it, and keep its data backed up."],
  ];
  for (const [reason, headline, detail, action] of fx) {
    assert.deepEqual(drive([reason]), { headline, detail, action }, reason);
  }
});
const SMART_PLAIN: [string, string][] = [
  ["Reallocated_Sector_Ct", "worn-out sectors it has replaced"],
  ["Reported_Uncorrect", "read errors it could not fix"],
  ["Command_Timeout", "commands that timed out"],
  ["Current_Pending_Sector", "sectors waiting to be checked"],
  ["Offline_Uncorrectable", "sectors it could not read"],
  ["UDMA_CRC_Error_Count", "cable or connection errors"],
  ["Raw_Read_Error_Rate", "read errors"],
];
test("SMART attributes read in plain words in every rule form", () => {
  for (const [raw, plain] of SMART_PLAIN) {
    const low = raw.toLowerCase().replace(/_/g, " ");
    const forms = [`${raw} failing now (pre-fail attribute at/below threshold)`, `${raw} failed its threshold previously`, `7 ${low}`];
    for (const r of forms) {
      const a = drive([r]) as { headline: string; detail: string };
      assert.ok(a.detail.includes(plain), r);
      assert.ok(!a.detail.includes(raw) && !a.detail.includes(low), r);
      assert.ok(a.detail.length <= 100 && a.headline.length <= 100, r);
    }
  }
});
test("unknown SMART attribute drops the name", () => {
  assert.equal(drive(["Mystery_Attr failing now (pre-fail attribute at/below threshold)"]).detail, "A key health reading has crossed its failure line.");
  assert.equal(drive(["Mystery_Attr failed its threshold previously"]).detail, "A health reading failed once before.");
  assert.equal(drive(["4 mystery attr"]).detail, "It has logged 4 errors, an early sign of wear.");
});
test("drive selection prefers a bad-class reason over an earlier warn-class one", () => {
  assert.equal(drive(["wear at 85%", "3 media errors"]).headline, "Drive sda is failing");
});
test("drive fallback A0", () => {
  const a0 = { headline: "Drive sda needs checking", detail: "Its health check flagged a problem.", action: "Check it on the Resources page." };
  assert.deepEqual(drive(["some new smartctl line"]), a0);
  assert.deepEqual(drive([]), a0);
});
test("S3 drive stopped reporting", () => {
  assert.deepEqual(driveUnreadable("sda"), {
    headline: "Drive sda stopped reporting",
    detail: "Its health readings stopped coming through. It may have disconnected.",
    action: "Check the drive on the Resources page.",
  });
});

// --- integrity (2c) ---
test("I1-I3 and I0", () => {
  assert.deepEqual(integrityAlert(["data: 2 filesystem errors"]), {
    headline: "data has file system errors",
    detail: "2 errors found in how files are stored. Some files may be damaged.",
    action: "Back up what's there, then run a disk check.",
  });
  assert.equal(integrityAlert(["data: 1 filesystem error"]).detail, "1 error found in how files are stored. Some files may be damaged.");
  assert.deepEqual(integrityAlert(["RAID array md0 degraded (2/3)"]), {
    headline: "Array md0 lost a drive",
    detail: "Only 2 of its 3 drives are working. One more failure loses data.",
    action: "Replace the failed drive soon.",
  });
  assert.equal(
    integrityAlert(["RAID array md0 degraded (?/?)"]).detail,
    "It's running without one of its drives. One more failure loses data.",
  );
  assert.deepEqual(integrityAlert(["pool tank DEGRADED"]), {
    headline: "Storage pool tank at risk",
    detail: "A disk has dropped out and is running without full protection.",
    action: "Check its drives on the Resources page.",
  });
  const pool = (st: string) => integrityAlert([`pool tank ${st}`]).detail;
  assert.equal(pool("FAULTED"), "It has stopped working and is running without full protection.");
  assert.equal(pool("UNAVAIL"), "It has stopped working and is running without full protection.");
  assert.equal(pool("OFFLINE"), "It reports a fault and is running without full protection.");
  const i0 = { headline: "The storage array has a problem", detail: "It reported a fault.", action: "Check it on the Resources page." };
  assert.deepEqual(integrityAlert(["mystery"]), i0);
  assert.deepEqual(integrityAlert([]), i0);
});

// --- disk ---
test("D1 and D2", () => {
  assert.deepEqual(diskFull("/mnt/media", 88, 12), {
    headline: "/mnt/media is 88% full",
    detail: "At the current rate it fills up in about 12 days.",
    action: "Delete or move files you no longer need.",
  });
  assert.equal(diskFull("/", 88, 1).headline, "The system disk is 88% full");
  assert.equal(diskFull("/", 88, 1).detail, "At the current rate it fills up in about 1 day.");
  assert.equal(diskFull("/mnt/media", 90, null).detail, "Only 10% of its space is left.");
});

// --- backup ---
test("B1-B3", () => {
  assert.deepEqual(backupDetail("FAILED", "3d ago"), {
    detail: "Recent ODIP changes could be lost. Last good run: 3d ago.",
    action: "Check the backup job on the server and run it again.",
  });
  assert.equal(backupDetail("FAILED", null).detail, "Recent ODIP changes could be lost. There's no record of a good run.");
  assert.deepEqual(backupDetail("STALE", "3d ago"), {
    detail: "It hasn't succeeded on schedule. Last good run: 3d ago.",
    action: "Check the backup job on the server is still scheduled.",
  });
  assert.equal(backupDetail("STALE", null).detail, "It hasn't succeeded on schedule, and there's no record of a good run.");
  assert.deepEqual(backupCheckStopped("2d ago"), {
    headline: "The ODIP backup check has stopped",
    detail: "It last ran 2d ago, so the backup status shown may be out of date.",
    action: "Make sure the backup check is still scheduled.",
  });
});

// --- length and jargon ---
test("every builder stays inside the headline, detail and action limits", () => {
  const many = "9999";
  const all = [
    containerDown(id("x".repeat(40)), "12d 23h"),
    containerCrashed(id("x".repeat(40)), 137),
    stuckRestarting(id("x".repeat(40)), 9999),
    keepsRestarting(id("x".repeat(40)), 9999, 9999),
    containerUnhealthy(id("x".repeat(40))),
    driveUnreadable("n".repeat(40)),
    diskFull("/mnt/" + "m".repeat(40), 100, 30),
    diskFull("/", 100, null),
    backupCheckStopped("12d ago"),
    { headline: "x", ...backupDetail("FAILED", "12d ago") },
    { headline: "x", ...backupDetail("STALE", null) },
    integrityAlert([`${"f".repeat(40)}: ${many} filesystem errors`]),
    integrityAlert([`RAID array ${"m".repeat(40)} degraded (${many}/${many})`]),
    integrityAlert([`pool ${"p".repeat(40)} UNAVAIL`]),
    integrityAlert([]),
    ...[
      "SMART overall self-assessment failed",
      "NVMe critical warning bitfield 0xff",
      `${many} media errors`,
      "available spare 100% below threshold 100%",
      `${"A".repeat(24)} failing now (pre-fail attribute at/below threshold)`,
      `${"L".repeat(24)} at 100 °C, at/above critical`,
      "available spare 100% approaching threshold 100%",
      `${"A".repeat(24)} failed its threshold previously`,
      `${many} ${"w".repeat(24)}`,
      `${"L".repeat(24)} 100 °C, 100 °C from critical`,
      "wear at 100%",
    ].map((r) => driveAlert("d".repeat(40), [r])),
  ];
  for (const a of all) {
    assert.ok(a.headline.length <= 48, `headline ${a.headline.length}: ${a.headline}`);
    assert.ok((a.detail ?? "").length <= 100, `detail ${a.detail?.length}: ${a.detail}`);
    assert.ok((a.action ?? "").length <= 70, `action ${a.action?.length}: ${a.action}`);
    assert.doesNotMatch(a.headline, /SMART|restart-loop|healthcheck|exited|bitfield|threshold|UNKNOWN|\/dev\//);
  }
});

// --- front door camera ---
// Copy.cs ToastTitleMax / ToastTextMax (desk/Core/Copy.cs): the desk widget raises hits as toasts.
const DESK_TOAST_TITLE_MAX = 63;
const DESK_TOAST_TEXT_MAX = 255;
test("doorbellQuiet copy: with and without a day count, and it fits every surface", () => {
  const c = doorbellQuietCopy(68);
  assert.equal(c.headline, "Front door camera has gone quiet");
  assert.equal(c.detail, "No motion reported for 68 days.");
  assert.equal(doorbellQuietCopy(1).detail, "No motion reported for 1 day.");
  assert.equal(doorbellQuietCopy(null).detail, "It has not reported any motion.");
  for (const x of [c, doorbellQuietCopy(null)]) {
    assert.ok(x.headline.length <= 48 && x.headline.length <= DESK_TOAST_TITLE_MAX);
    assert.ok(x.detail!.length <= 100 && x.detail!.length <= DESK_TOAST_TEXT_MAX);
    assert.ok(x.action!.length <= 70);
    assert.ok(!/ring|!/i.test(`${x.headline}${x.detail}${x.action}`.replace(/during|bring/gi, "")));
  }
});

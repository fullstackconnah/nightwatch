import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBackupStatus, summarizeBackup, backupHeadline, drillAge, checkRestoreDate, drillPayload, applyRestoreDrill, drillDateText, drillAgeText, type BackupStatus } from "./backup-status.ts";
import { localDateString } from "./local-time.ts";

const NOW = Date.parse("2026-10-15T12:00:00+11:00");
const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function file(over: { checkedAgo?: number; backup?: object | null; restore?: object | null } = {}): string {
  const items = [
    over.backup === null
      ? null
      : { kind: "backup", ok: true, state: "OK", at: iso(13 * HOUR), ref: "odip-2026-10-15.sql.gz 41M sha256:abc", detail: "x", ...over.backup },
    over.restore === null
      ? null
      : { kind: "restore-test", ok: true, state: "OK", at: iso(30 * HOUR), ref: "restore ok", detail: "y", ...over.restore },
  ].filter(Boolean);
  return JSON.stringify({ checked_at: iso(over.checkedAgo ?? 3 * HOUR), items });
}

function summary(raw: string | null) {
  const s = parseBackupStatus(raw);
  assert.equal(s.status, "ok");
  return summarizeBackup(s as Extract<BackupStatus, { status: "ok" }>, NOW);
}

describe("parseBackupStatus", () => {
  it("missing file is a neutral 'missing', not an error", () => {
    assert.deepEqual(parseBackupStatus(null), { status: "missing" });
  });

  it("bad JSON is unreadable with a short reason", () => {
    assert.deepEqual(parseBackupStatus("{not json"), { status: "unreadable", reason: "not valid JSON" });
  });

  it("a file without an items list is unreadable", () => {
    const s = parseBackupStatus(JSON.stringify({ checked_at: iso(0) }));
    assert.equal(s.status, "unreadable");
  });

  it("an unknown state word is unreadable, never guessed", () => {
    const s = parseBackupStatus(file({ backup: { state: "WEIRD" } }));
    assert.deepEqual(s, { status: "unreadable", reason: "unknown state WEIRD" });
  });

  it("drops the raw log line (ref) and the detail text", () => {
    const s = parseBackupStatus(file());
    assert.equal(s.status, "ok");
    assert.ok(!JSON.stringify(s).includes("sha256"));
    assert.ok(!JSON.stringify(s).includes("detail"));
  });
});

describe("summarizeBackup", () => {
  it("an OK item with no timestamp is STALE", () => {
    const s = summary(file({ backup: { at: null } }));
    assert.equal(s.items[0].state, "STALE");
  });
  it("all OK", () => {
    const s = summary(file());
    assert.equal(s.worst, "OK");
    assert.equal(s.checkStale, false);
    assert.deepEqual(
      s.items.map((i) => [i.kind, i.state, i.at]),
      [
        ["backup", "OK", iso(13 * HOUR)],
        ["restore-test", "OK", iso(30 * HOUR)],
      ],
    );
  });

  it("one STALE makes the whole thing STALE", () => {
    const s = summary(file({ restore: { state: "STALE", ok: false } }));
    assert.equal(s.worst, "STALE");
    assert.equal(s.items[1].state, "STALE");
    assert.equal(s.items[0].state, "OK");
  });

  it("one FAILED beats a STALE", () => {
    const s = summary(file({ backup: { state: "FAILED", ok: false }, restore: { state: "STALE" } }));
    assert.equal(s.worst, "FAILED");
    assert.equal(s.items[0].state, "FAILED");
  });

  it("an old check alone no longer turns OK rows STALE, and FAILED stays", () => {
    const s = summary(file({ checkedAgo: 27 * HOUR, backup: { state: "FAILED" } }));
    assert.equal(s.checkStale, true);
    assert.equal(s.worst, "FAILED");
    assert.deepEqual(s.items.map((i) => i.state), ["FAILED", "OK"]);
  });

  it("a restore test passed 2 days ago with a 30 h old check stays OK", () => {
    const s = summary(file({ checkedAgo: 30 * HOUR, backup: { at: iso(25 * HOUR) }, restore: { at: iso(48 * HOUR) } }));
    assert.equal(s.checkStale, true);
    assert.equal(s.worst, "OK");
    assert.deepEqual(s.items.map((i) => i.state), ["OK", "OK"]);
  });

  it("a restore test past 7 d + 2 h is STALE, just under is not", () => {
    assert.equal(summary(file({ restore: { at: iso(7 * 24 * HOUR + 2.1 * HOUR) } })).items[1].state, "STALE");
    assert.equal(summary(file({ restore: { at: iso(7 * 24 * HOUR + 1.9 * HOUR) } })).items[1].state, "OK");
  });

  it("a daily backup 27 h old is STALE", () => {
    const s = summary(file({ backup: { at: iso(27 * HOUR) } }));
    assert.deepEqual(s.items.map((i) => i.state), ["STALE", "OK"]);
    assert.equal(s.worst, "STALE");
  });

  it("a check just under 26 h is still fresh", () => {
    const s = summary(file({ checkedAgo: 25.9 * HOUR }));
    assert.equal(s.checkStale, false);
    assert.equal(s.worst, "OK");
  });

  it("a missing item kind shows as STALE with no timestamp", () => {
    const s = summary(file({ restore: null }));
    assert.equal(s.worst, "STALE");
    assert.deepEqual(s.items[1], { kind: "restore-test", state: "STALE", at: null });
  });
});

describe("backupHeadline", () => {
  it("names both items when the states differ, failed first", () => {
    const s = summary(file({ backup: { state: "STALE" }, restore: { state: "FAILED" } }));
    assert.equal(backupHeadline(s), "ODIP restore test failed; nightly backup is late");
  });
  it("joins two failed or two stale items", () => {
    assert.equal(backupHeadline(summary(file({ backup: { state: "FAILED" }, restore: { state: "FAILED" } }))), "ODIP nightly backup and restore test failed");
    assert.equal(backupHeadline(summary(file({ backup: { state: "STALE" }, restore: { state: "STALE" } }))), "ODIP nightly backup and restore test are late");
  });
  it("says late for a single stale item", () => {
    assert.equal(backupHeadline(summary(file({ backup: { state: "STALE" } }))), "ODIP nightly backup is late");
  });
  it("names one item when only one is bad", () => {
    assert.equal(backupHeadline(summary(file({ backup: { state: "FAILED" } }))), "ODIP nightly backup failed");
  });
});

describe("restore drill", () => {
  const today = "2026-11-16";
  const INVALID = "That isn't a real date. Pick one from the calendar.";

  it("drillAge 90 days is ok", () => {
    assert.deepEqual(drillAge({ testedOn: "2026-08-18", today }), { state: "ok", days: 90 });
  });
  it("drillAge 91 days is due", () => {
    assert.deepEqual(drillAge({ testedOn: "2026-08-17", today }), { state: "due", days: 91 });
  });
  it("drillAge null is none", () => {
    assert.deepEqual(drillAge({ testedOn: null, today }), { state: "none" });
  });
  it("drillAge future clamps to 0 ok", () => {
    assert.deepEqual(drillAge({ testedOn: "2026-11-20", today }), { state: "ok", days: 0 });
  });
  it("drillAge across DST", () => {
    assert.equal((drillAge({ testedOn: "2026-10-03", today: "2026-10-05" }) as { days: number }).days, 2);
  });
  it("zone decides today", () => {
    const t = localDateString("Australia/Sydney", new Date("2026-11-15T14:30:00Z"));
    assert.equal(t, "2026-11-16");
    assert.deepEqual(drillAge({ testedOn: "2026-08-18", today: t }), { state: "ok", days: 90 });
    assert.deepEqual(drillAge({ testedOn: "2026-08-18", today: "2026-11-15" }), { state: "ok", days: 89 });
  });

  it("checkRestoreDate blank clears, trims, saves today", () => {
    assert.deepEqual(checkRestoreDate({ testedOn: "" }, today), { ok: true, value: null });
    assert.deepEqual(checkRestoreDate({ testedOn: "   " }, today), { ok: true, value: null });
    assert.deepEqual(checkRestoreDate({ testedOn: " 2026-10-12 " }, today), { ok: true, value: "2026-10-12" });
    assert.deepEqual(checkRestoreDate({ testedOn: today }, today), { ok: true, value: today });
  });
  it("checkRestoreDate rejects bad shapes", () => {
    for (const raw of [{ testedOn: "2026-13-01" }, { testedOn: "2026-02-30" }, { testedOn: "12/10/2026" }, { testedOn: "2026-10-12x" }, { testedOn: 20261012 }, {}, null, "2026-10-12", undefined]) {
      assert.deepEqual(checkRestoreDate(raw, today), { ok: false, error: INVALID }, JSON.stringify(raw));
    }
  });
  it("checkRestoreDate rejects too long, before 2000 and future", () => {
    assert.deepEqual(checkRestoreDate({ testedOn: "2026-10-12" + "0".repeat(500) }, today), { ok: false, error: INVALID });
    assert.deepEqual(checkRestoreDate({ testedOn: "1999-12-31" }, today), { ok: false, error: "Pick a date from 2000 on." });
    assert.deepEqual(checkRestoreDate({ testedOn: "2026-11-17" }, today), { ok: false, error: "That date hasn't happened yet. Enter the day you last tested a restore." });
  });

  it("drillPayload drops an invalid stored value and keeps a future one", () => {
    assert.deepEqual(drillPayload("garbage", today), { testedOn: null, today });
    assert.deepEqual(drillPayload(undefined, today), { testedOn: null, today });
    assert.deepEqual(drillPayload("2026-10-12", today), { testedOn: "2026-10-12", today });
    assert.deepEqual(drillPayload("2026-11-20", today), { testedOn: "2026-11-20", today });
  });
});

describe("restore drill save", () => {
  const today = "2026-11-16";
  const config = { widgets: [1, 2], bins: { collections: [] }, hermes: { tier: "local" }, nested: { a: [1, { b: 2 }] }, calendar: { url: "x" } };
  const others = (c: object) => JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => k !== "restoreTestedOn")));

  it("a save changes only restoreTestedOn", () => {
    const r = applyRestoreDrill(config, { testedOn: " 2026-10-12 " }, today);
    assert.ok("next" in r);
    assert.equal(r.next.restoreTestedOn, "2026-10-12");
    assert.equal(others(r.next), others(config));
    assert.equal("restoreTestedOn" in config, false, "the input is not mutated");
  });
  it("a clear deletes only restoreTestedOn", () => {
    const r = applyRestoreDrill({ ...config, restoreTestedOn: "2026-10-12" }, { testedOn: "" }, today);
    assert.ok("next" in r);
    assert.equal("restoreTestedOn" in r.next, false);
    assert.equal(others(r.next), others(config));
  });
  it("a rejected value saves nothing and returns the field error", () => {
    assert.deepEqual(applyRestoreDrill(config, { testedOn: "2026-11-17" }, today), { error: "That date hasn't happened yet. Enter the day you last tested a restore." });
  });
});

describe("restore drill text", () => {
  it("dates and ages read plainly", () => {
    assert.equal(drillDateText("2026-10-12"), "12 Oct 2026");
    assert.equal(drillDateText("2026-01-05"), "5 Jan 2026");
    assert.deepEqual([0, 1, 35].map(drillAgeText), ["today", "1 day ago", "35 days ago"]);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBackupStatus, summarizeBackup, backupHeadline, type BackupStatus } from "./backup-status.ts";

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

  it("a check older than 26 h turns its OK rows STALE but keeps FAILED", () => {
    const s = summary(file({ checkedAgo: 27 * HOUR, backup: { state: "FAILED" } }));
    assert.equal(s.checkStale, true);
    assert.equal(s.worst, "FAILED");
    assert.deepEqual(s.items.map((i) => i.state), ["FAILED", "STALE"]);
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
  it("names both items when both are bad, worst first", () => {
    const s = summary(file({ backup: { state: "STALE" }, restore: { state: "FAILED" } }));
    assert.equal(backupHeadline(s), "ODIP restore test failed, nightly backup stale");
  });
  it("names one item when only one is bad", () => {
    assert.equal(backupHeadline(summary(file({ backup: { state: "FAILED" } }))), "ODIP nightly backup failed");
  });
});

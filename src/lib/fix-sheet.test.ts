import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./api-error.ts";
import type { AttentionReport } from "./attention-report.ts";
import { actionErrorText, doneText, fixFor, logsErrorText, stillFailing, tailLines } from "./fix-sheet.ts";
import { homeRows } from "./home.ts";

const ROW = (probe: string | undefined, subject: string) => ({ probe: probe as never, subject });

test("fixFor maps crashes to start, health to restart, restarts to no action", () => {
  assert.equal(fixFor(ROW("crashes", "container:radarr"))?.action, "start");
  assert.equal(fixFor(ROW("health", "container:radarr"))?.action, "restart");
  const r = fixFor(ROW("restarts", "container:radarr"));
  assert.equal(r?.action, null);
  assert.equal(r?.name, "radarr");
});

test("fixFor returns null for every non-container probe and for failed:* rows", () => {
  for (const p of ["smart", "mounts", "disks", "backup", "doorbell", "orchestra", "outside"]) {
    assert.equal(fixFor(ROW(p, "container:radarr")), null, p);
    assert.equal(fixFor(ROW(p, p)), null, p);
  }
  assert.equal(fixFor(ROW(undefined, "failed:docker")), null);
  assert.equal(fixFor(ROW(undefined, "failed:crashes")), null);
  assert.equal(fixFor(ROW("crashes", "failed:crashes")), null);
});

test("fixFor keeps a long name whole in both URLs", () => {
  const f = fixFor(ROW("crashes", "container:homeassistant-companion"));
  assert.equal(f?.actionUrl, "/api/docker/containers/homeassistant-companion/action");
  assert.equal(f?.logsUrl, "/api/docker/containers/homeassistant-companion/logs?tail=20");
});

test("fixFor refuses a subject whose name fails isContainerId", () => {
  for (const s of ["container:../x", "container:a/b", "container:", "container:-x", "container:a b"]) {
    assert.equal(fixFor(ROW("crashes", s)), null, s);
  }
});

const L = (hms: string, msg: string) => `2026-11-12T${hms}.123456789Z ${msg}`;

test("tailLines keeps the last 20 non-blank lines, shortens the timestamp and clips each message to 200 chars", () => {
  const raw = Array.from({ length: 30 }, (_, i) => L("14:02:01", `line ${i}`)).join("\n\n") + "\n";
  const out = tailLines(raw, 0);
  assert.equal(out.length, 20);
  assert.equal(out[0], "14:02:01 line 10");
  assert.equal(out[19], "14:02:01 line 29");
  const long = tailLines(L("09:05:07", "x".repeat(500)), 0)[0];
  assert.equal(long, `09:05:07 ${"x".repeat(200)}…`);
  const emoji = tailLines(`${"a".repeat(199)}😀 more text`)[0];
  assert.equal(emoji, `${"a".repeat(199)}😀…`);
  assert.equal(tailLines(L("23:30:00", "a"), 60)[0], "00:30:00 a"); // offset applies
  assert.equal(tailLines("no stamp here", 0)[0], "no stamp here");
});

test("tailLines treats markup as plain text", () => {
  const evil = "<img src=x onerror=alert(1)>";
  assert.equal(tailLines(L("01:02:03", evil), 0)[0], `01:02:03 ${evil}`);
});

test("tailLines on empty or whitespace-only logs returns []", () => {
  assert.deepEqual(tailLines(""), []);
  assert.deepEqual(tailLines("  \n\t\n \n"), []);
});

test("actionErrorText maps status to copy and rearm", () => {
  const a = actionErrorText(new ApiError("unauthorized", 401), "restart", true);
  assert.deepEqual(a, { text: "You're signed out. Sign in again to restart it.", rearm: false });
  assert.equal(actionErrorText(new ApiError("x", 401), "start", true).text, "You're signed out. Sign in again to start it.");
  assert.deepEqual(actionErrorText(new ApiError("gone", 404), "start", true), { text: "That container no longer exists.", rearm: false });
  assert.deepEqual(actionErrorText(new ApiError("Docker is busy.", 409), "start", true), { text: "Docker is busy.", rearm: true });
  assert.deepEqual(actionErrorText(new ApiError("Socket proxy refused.", 403), "restart", true), { text: "Socket proxy refused.", rearm: true });
  const clipped = actionErrorText(new ApiError("y".repeat(300), 500), "restart", true).text;
  assert.equal(clipped.length, 201);
  const off = { text: "You're offline. Nothing was sent.", rearm: true };
  assert.deepEqual(actionErrorText(new TypeError("Failed to fetch"), "restart", false), off);
  assert.deepEqual(actionErrorText(new TypeError("Failed to fetch"), "restart", true), {
    text: "Couldn't confirm it went through. This row updates at the next check, within 30 s.",
    rearm: false,
  });
  assert.deepEqual(actionErrorText(new ApiError("x", 500), "restart", false), off);
  assert.equal(actionErrorText(new ApiError("HTTP 500", 500), "restart", true).rearm, true);
});

test("logsErrorText maps status to the log box copy", () => {
  assert.equal(logsErrorText(new ApiError("unauthorized", 401), true).kind, "signedout");
  assert.equal(logsErrorText(new ApiError("x", 404), true).text, "That container no longer exists.");
  assert.equal(logsErrorText(new ApiError("x", 502), true).text, "Couldn't read logs.");
  assert.equal(logsErrorText(new TypeError("Failed to fetch"), true).text, "You're offline. Logs load when you're back.");
});

test("doneText for start and restart", () => {
  const at = Date.UTC(2026, 10, 12, 14, 2, 30);
  assert.equal(doneText("restart", at, 0), "Restarted at 14:02. This row clears at the next check, within 30 s.");
  assert.equal(doneText("start", at, 0), "Started at 14:02. This row clears at the next check, within 30 s.");
});

test("stillFailing is true only when a later report still lists the hit", () => {
  const done = Date.parse("2026-11-12T14:02:00Z");
  assert.equal(stillFailing(done, "2026-11-12T14:01:50Z", true), false);
  assert.equal(stillFailing(done, "2026-11-12T14:02:00Z", true), false);
  assert.equal(stillFailing(done, "2026-11-12T14:02:30Z", true), true);
  assert.equal(stillFailing(done, "2026-11-12T14:02:30Z", false), false);
});

test("homeRows gives container rows with a fix the Home-only action line", () => {
  const hit = (probe: string, subject: string) => ({
    id: `${probe}:${subject}`, probe, subject, severity: "bad", headline: "h", action: "old", firstSeen: "2026-11-12T14:00:00Z",
    owner: { href: "/x", label: "X" },
  });
  const report = {
    checkedAt: "2026-11-12T14:00:00Z",
    probes: [],
    hits: [hit("crashes", "container:a"), hit("health", "container:b"), hit("restarts", "container:c"), hit("smart", "drive:sda"), hit("crashes", "container:../x")],
  } as unknown as AttentionReport;
  const a = homeRows(report).map((r) => r.action);
  assert.deepEqual(a, [
    "Open for the last log lines and a fix.",
    "Open for the last log lines and a fix.",
    "Open for the last log lines.",
    "old",
    "old",
  ]);
});

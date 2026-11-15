import test from "node:test";
import assert from "node:assert/strict";
import { calendarStatusLine, type CalendarStatus } from "./calendar-status.ts";

const synced = new Date(2026, 10, 12, 14, 40).toISOString(); // Thursday, device-local
const base: CalendarStatus = { configured: true, updatedAt: synced, lastSyncAt: synced, eventsThisWeek: 14, problem: null };

test("nothing saved, or not synced yet: no status line", () => {
  assert.equal(calendarStatusLine({ ...base, configured: false, lastSyncAt: null, eventsThisWeek: null }), null);
  assert.equal(calendarStatusLine({ ...base, lastSyncAt: null, eventsThisWeek: null }), null);
  assert.equal(calendarStatusLine({ ...base, lastSyncAt: null, eventsThisWeek: null, problem: "refused" }), null);
});

test("connected: the count reads in plain words", () => {
  assert.deepEqual(calendarStatusLine(base), { tone: "ok", text: "Calendar connected · 14 events this week" });
  assert.equal(calendarStatusLine({ ...base, eventsThisWeek: 1 })?.text, "Calendar connected · 1 event this week");
  assert.equal(calendarStatusLine({ ...base, eventsThisWeek: 0 })?.text, "Calendar connected · no events this week");
});

test("a later problem reads as a warning with its reason", () => {
  const warn = (problem: NonNullable<CalendarStatus["problem"]>) => calendarStatusLine({ ...base, problem });
  assert.deepEqual(warn("refused"), { tone: "warn", text: "Not syncing since Thu 2:40 pm: the calendar refused the link (copy a fresh private link and Replace)." });
  assert.equal(warn("unreachable")?.text, "Not syncing since Thu 2:40 pm: the calendar stopped answering.");
  assert.equal(warn("not-calendar")?.text, "Not syncing since Thu 2:40 pm: the link is no longer a calendar.");
  assert.equal(warn("too-large")?.text, "Not syncing since Thu 2:40 pm: the calendar is too large to read.");
});

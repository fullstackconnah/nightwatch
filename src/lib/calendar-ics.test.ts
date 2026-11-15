import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIcs } from "./calendar-ics.ts";

// Synthetic feeds only. 2026-11-15 is a Sunday; Sydney is on daylight time (+11:00) from 2026-10-04.
const SYD = "Australia/Sydney";
const cal = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const win = (a: string, b: string) => [Date.parse(a), Date.parse(b)] as const;
const WEEK = win("2026-11-16T00:00:00+11:00", "2026-11-23T00:00:00+11:00");
const run = (text: string, w = WEEK, tz = SYD) => parseIcs(text, w[0], w[1], tz);
const starts = (text: string, w = WEEK, tz = SYD) => run(text, w, tz).map((e) => e.start).sort();
const MON9 = "DTSTART;TZID=Australia/Sydney:20261116T090000";
const MON9END = "DTEND;TZID=Australia/Sydney:20261116T100000";

describe("parseIcs text", () => {
  it("unfolds lines and unescapes text", () => {
    const text = cal(vevent("UID:a", MON9, "SUMMARY:Lunch\\, with", "  Gran\\nbring\\Ncake\\; \\\\ end"));
    const [e] = run(text);
    assert.equal(e.title, "Lunch, with Gran\nbring\ncake; \\ end");
    assert.equal(e.busy, false);
  });
  it("ignores unknown properties and components, and a missing title is null but not busy", () => {
    const text = cal("BEGIN:VTODO\r\nSUMMARY:no\r\nEND:VTODO", vevent("UID:a", MON9, "X-WHATEVER;FOO=1:bar", "SUMMARY:"));
    const out = run(text);
    assert.equal(out.length, 1);
    assert.deepEqual([out[0].title, out[0].busy], [null, false]);
  });
  it("private and confidential give a null title and busy", () => {
    for (const cls of ["PRIVATE", "CONFIDENTIAL"]) {
      const [e] = run(cal(vevent("UID:a", MON9, "SUMMARY:Secret thing", `CLASS:${cls}`)));
      assert.deepEqual([e.title, e.busy], [null, true], cls);
    }
    const [pub] = run(cal(vevent("UID:a", MON9, "SUMMARY:Open", "CLASS:PUBLIC", "TRANSP:TRANSPARENT")));
    assert.deepEqual([pub.title, pub.busy], ["Open", false]);
  });
  it("drops a cancelled event", () => {
    assert.deepEqual(run(cal(vevent("UID:a", MON9, "STATUS:CANCELLED", "SUMMARY:x"))), []);
  });
  it("ids are the UID plus the start, stable across parses", () => {
    const text = cal(vevent("UID:abc-1", MON9, "SUMMARY:x", "RRULE:FREQ=DAILY;COUNT=2"));
    const a = run(text).map((e) => e.id);
    assert.deepEqual(a, run(text).map((e) => e.id));
    assert.equal(new Set(a).size, 2);
    assert.ok(a.every((id) => id.includes("abc-1")));
  });
});

describe("parseIcs times", () => {
  it("resolves a TZID time on both sides of a daylight-saving change", () => {
    const w = win("2026-09-30T00:00:00Z", "2026-10-10T00:00:00Z");
    const mk = (d: string) => cal(vevent("UID:a", `DTSTART;TZID=Australia/Sydney:${d}T090000`, `DTEND;TZID=Australia/Sydney:${d}T100000`, "SUMMARY:x"));
    assert.deepEqual(starts(mk("20261003"), w, "UTC"), ["2026-10-02T23:00:00+00:00"]);
    assert.deepEqual(starts(mk("20261005"), w, "UTC"), ["2026-10-04T22:00:00+00:00"]);
    assert.deepEqual(starts(mk("20261003"), w, SYD), ["2026-10-03T09:00:00+10:00"]);
    assert.deepEqual(starts(mk("20261005"), w, SYD), ["2026-10-05T09:00:00+11:00"]);
  });
  it("a weekly repeat across a daylight-saving change keeps its wall-clock time", () => {
    const w = win("2026-09-20T00:00:00+10:00", "2026-10-31T00:00:00+11:00");
    const text = cal(vevent("UID:a", "DTSTART;TZID=Australia/Sydney:20260926T090000", "DTEND;TZID=Australia/Sydney:20260926T100000", "RRULE:FREQ=WEEKLY;COUNT=4", "SUMMARY:x"));
    assert.deepEqual(starts(text, w), [
      "2026-09-26T09:00:00+10:00", "2026-10-03T09:00:00+10:00", "2026-10-10T09:00:00+11:00", "2026-10-17T09:00:00+11:00",
    ]);
  });
  it("an unknown or Windows-style zone name falls back to the display zone", () => {
    for (const tzid of ["Mars/Olympus_Mons", "AUS Eastern Standard Time"]) {
      const text = cal(vevent("UID:a", `DTSTART;TZID=${tzid}:20261116T090000`, "SUMMARY:x"));
      assert.deepEqual(starts(text), ["2026-11-16T09:00:00+11:00"], tzid);
    }
  });
  it("UTC, floating, a quoted TZID and no DTEND", () => {
    assert.deepEqual(starts(cal(vevent("UID:a", "DTSTART:20261116T000000Z", "SUMMARY:x"))), ["2026-11-16T11:00:00+11:00"]);
    assert.deepEqual(starts(cal(vevent("UID:a", "DTSTART:20261116T090000", "SUMMARY:x"))), ["2026-11-16T09:00:00+11:00"]);
    assert.deepEqual(starts(cal(vevent("UID:a", 'DTSTART;TZID="Australia/Sydney":20261116T090000', "SUMMARY:x"))), ["2026-11-16T09:00:00+11:00"]);
    const [timed] = run(cal(vevent("UID:a", MON9, "SUMMARY:x")));
    assert.equal(timed.end, timed.start);
    const [dur] = run(cal(vevent("UID:a", MON9, "DURATION:PT1H30M", "SUMMARY:x")));
    assert.equal(dur.end, "2026-11-16T10:30:00+11:00");
  });
  it("all-day and multi-day (end exclusive), and an all-day with no end is one day", () => {
    const [one] = run(cal(vevent("UID:a", "DTSTART;VALUE=DATE:20261118", "DTEND;VALUE=DATE:20261119", "SUMMARY:x")));
    assert.deepEqual([one.allDay, one.start, one.end], [true, "2026-11-18T00:00:00+11:00", "2026-11-19T00:00:00+11:00"]);
    const [multi] = run(cal(vevent("UID:a", "DTSTART;VALUE=DATE:20261118", "DTEND;VALUE=DATE:20261121", "SUMMARY:x")));
    assert.equal(multi.end, "2026-11-21T00:00:00+11:00");
    const [bare] = run(cal(vevent("UID:a", "DTSTART;VALUE=DATE:20261118", "SUMMARY:x")));
    assert.equal(bare.end, "2026-11-19T00:00:00+11:00");
    // Ended exactly at the window start: not in the window.
    assert.deepEqual(run(cal(vevent("UID:a", "DTSTART;VALUE=DATE:20261115", "DTEND;VALUE=DATE:20261116", "SUMMARY:x"))), []);
    // Started before and still running: in.
    assert.equal(run(cal(vevent("UID:a", "DTSTART;VALUE=DATE:20261114", "DTEND;VALUE=DATE:20261117", "SUMMARY:x"))).length, 1);
  });
});

describe("parseIcs repeats", () => {
  const daily = (...extra: string[]) => cal(vevent("UID:a", MON9, MON9END, "SUMMARY:x", ...extra));
  it("INTERVAL, COUNT and UNTIL (in UTC)", () => {
    assert.equal(starts(daily("RRULE:FREQ=DAILY;COUNT=2")).length, 2);
    assert.equal(starts(daily("RRULE:FREQ=DAILY;INTERVAL=2")).length, 4);
    // Wed 09:00 Sydney is Tue 22:00Z, still before the UNTIL midnight; Thu 09:00 is Wed 22:00Z, after it.
    assert.deepEqual(starts(daily("RRULE:FREQ=DAILY;UNTIL=20261118T000000Z")), [
      "2026-11-16T09:00:00+11:00", "2026-11-17T09:00:00+11:00", "2026-11-18T09:00:00+11:00",
    ]);
    assert.equal(starts(daily("RRULE:FREQ=DAILY;UNTIL=20261117T090000")).length, 2);
  });
  it("EXDATE removes one occurrence", () => {
    assert.deepEqual(starts(daily("RRULE:FREQ=DAILY;COUNT=3", "EXDATE;TZID=Australia/Sydney:20261117T090000")), [
      "2026-11-16T09:00:00+11:00", "2026-11-18T09:00:00+11:00",
    ]);
  });
  it("a RECURRENCE-ID moves one occurrence, and a cancelled one removes it", () => {
    const master = vevent("UID:a", MON9, MON9END, "SUMMARY:x", "RRULE:FREQ=DAILY;COUNT=3");
    const moved = vevent("UID:a", "RECURRENCE-ID;TZID=Australia/Sydney:20261117T090000", "DTSTART;TZID=Australia/Sydney:20261117T140000", "DTEND;TZID=Australia/Sydney:20261117T150000", "SUMMARY:moved");
    const gone = vevent("UID:a", "RECURRENCE-ID;TZID=Australia/Sydney:20261117T090000", "DTSTART;TZID=Australia/Sydney:20261117T140000", "STATUS:CANCELLED");
    assert.deepEqual(run(cal(master, moved)).map((e) => [e.start, e.title]).sort(), [
      ["2026-11-16T09:00:00+11:00", "x"], ["2026-11-17T14:00:00+11:00", "moved"], ["2026-11-18T09:00:00+11:00", "x"],
    ]);
    assert.deepEqual(starts(cal(master, gone)), ["2026-11-16T09:00:00+11:00", "2026-11-18T09:00:00+11:00"]);
  });
  it("weekly with several BYDAY days", () => {
    const text = cal(vevent("UID:a", "DTSTART;TZID=Australia/Sydney:20261116T180000", "SUMMARY:x", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4"));
    assert.deepEqual(starts(text, win("2026-11-16T00:00:00+11:00", "2026-12-01T00:00:00+11:00")), [
      "2026-11-16T18:00:00+11:00", "2026-11-18T18:00:00+11:00", "2026-11-23T18:00:00+11:00", "2026-11-25T18:00:00+11:00",
    ]);
  });
  it("weekly INTERVAL=2 skips the odd weeks", () => {
    const text = cal(vevent("UID:a", "DTSTART;TZID=Australia/Sydney:20261102T090000", "SUMMARY:x", "RRULE:FREQ=WEEKLY;INTERVAL=2"));
    assert.deepEqual(starts(text, win("2026-11-02T00:00:00+11:00", "2026-12-07T00:00:00+11:00")), [
      "2026-11-02T09:00:00+11:00", "2026-11-16T09:00:00+11:00", "2026-11-30T09:00:00+11:00",
    ]);
  });
  it("any other repeat shows at its first occurrence only", () => {
    assert.equal(starts(cal(vevent("UID:a", MON9, "SUMMARY:x", "RRULE:FREQ=MONTHLY;BYDAY=1MO"))).length, 1);
    const earlier = cal(vevent("UID:a", "DTSTART;TZID=Australia/Sydney:20261019T090000", "SUMMARY:x", "RRULE:FREQ=MONTHLY"));
    assert.deepEqual(run(earlier), []);
    assert.deepEqual(run(cal(vevent("UID:a", "DTSTART;TZID=Australia/Sydney:20201116T090000", "SUMMARY:x", "RRULE:FREQ=YEARLY"))), []);
  });
  it("a repeat that started decades ago still lands in the window, quickly", { timeout: 5000 }, () => {
    const old = cal(vevent("UID:a", "DTSTART;TZID=Australia/Sydney:19950102T090000", "SUMMARY:x", "RRULE:FREQ=DAILY"));
    assert.equal(starts(old).length, 7);
    const weekly = cal(vevent("UID:a", "DTSTART;TZID=Australia/Sydney:19950102T090000", "SUMMARY:x", "RRULE:FREQ=WEEKLY;BYDAY=MO,TH"));
    assert.equal(starts(weekly).length, 2);
    const counted = cal(vevent("UID:a", "DTSTART;TZID=Australia/Sydney:19950102T090000", "SUMMARY:x", "RRULE:FREQ=DAILY;COUNT=99999999999"));
    assert.equal(starts(counted).length, 7);
  });
});

describe("parseIcs hostile input", () => {
  it("never throws or hangs on garbage", { timeout: 5000 }, () => {
    const bad = [
      "", "garbage", "BEGIN:VCALENDAR", "BEGIN:VEVENT\r\nEND:VEVENT", cal(vevent("DTSTART:garbage", "SUMMARY:x")),
      cal(vevent("UID:a", MON9, "RRULE:FREQ=DAILY;INTERVAL=0;COUNT=3", "SUMMARY:x")),
      cal(vevent("UID:a", MON9, "RRULE:FREQ=DAILY;COUNT=-4", "SUMMARY:x")),
      cal(vevent("UID:a", MON9, "RRULE:FREQ=WEEKLY;BYDAY=XX,;INTERVAL=abc", "SUMMARY:x")),
      cal(vevent("UID:a", "DTSTART;TZID=:20261116T250000", "SUMMARY:x")),
      "\0\0\0:::;;;", cal("BEGIN:VEVENT", MON9),
    ];
    for (const t of bad) assert.ok(Array.isArray(run(t)));
    assert.equal(run(bad[5]).length, 3);
  });
});

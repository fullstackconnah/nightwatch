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
  it("ids are a short key of the UID and the start, stable across parses, never the UID itself", () => {
    const text = cal(vevent("UID:abc-1", MON9, "SUMMARY:x", "RRULE:FREQ=DAILY;COUNT=2"));
    const a = run(text).map((e) => e.id);
    assert.deepEqual(a, run(text).map((e) => e.id));
    assert.equal(new Set(a).size, 2);
    assert.ok(a.every((id) => /^[0-9a-f]{12}$/.test(id)));
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
  it("a yearly repeat with leading-zero BYMONTH and BYMONTHDAY still repeats; a BYMONTH list does not", () => {
    const rule = (r: string) => cal(vevent("UID:a", "DTSTART;TZID=Australia/Sydney:20200305T090000", "SUMMARY:x", r));
    const w = win("2026-03-05T00:00:00+11:00", "2026-03-06T00:00:00+11:00");
    assert.equal(run(rule("RRULE:FREQ=YEARLY;BYMONTH=03;BYMONTHDAY=05"), w).length, 1);
    assert.equal(run(rule("RRULE:FREQ=YEARLY;BYMONTH=3,6"), w).length, 0);
  });
  it("an unsupported repeat shows at its first occurrence only", () => {
    assert.equal(starts(cal(vevent("UID:a", MON9, "SUMMARY:x", "RRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1"))).length, 1);
    const earlier = (rule: string) => cal(vevent("UID:a", "DTSTART;TZID=Australia/Sydney:20261019T090000", "SUMMARY:x", rule));
    for (const rule of ["RRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1", "RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15", "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1", "RRULE:FREQ=YEARLY;BYYEARDAY=100", "RRULE:FREQ=YEARLY;BYMONTH=3", "RRULE:FREQ=HOURLY"]) {
      assert.deepEqual(run(earlier(rule)), [], rule);
    }
  });
  describe("monthly and yearly", () => {
    const sy = (dtstart: string, rule: string, w = WEEK, extra: string[] = []) =>
      starts(cal(vevent("UID:a", dtstart.length === 8 ? `DTSTART;VALUE=DATE:${dtstart}` : `DTSTART;TZID=Australia/Sydney:${dtstart}`, "SUMMARY:x", `RRULE:${rule}`, ...extra)), w);
    const wide = win("2026-10-25T00:00:00+11:00", "2027-02-01T00:00:00+11:00");
    it("a yearly birthday from 1990 shows on its day and not the day before", () => {
      assert.deepEqual(sy("19901118", "FREQ=YEARLY"), ["2026-11-18T00:00:00+11:00"]);
      assert.deepEqual(sy("19901118", "FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=18"), ["2026-11-18T00:00:00+11:00"]);
      assert.deepEqual(sy("19901118", "FREQ=YEARLY;INTERVAL=2"), ["2026-11-18T00:00:00+11:00"]);
      assert.deepEqual(sy("19901118", "FREQ=YEARLY;INTERVAL=5"), []); // 1990 + 5k never reaches 2026
    });
    it("a 29 February yearly event shows only in leap years", () => {
      assert.deepEqual(sy("20240229", "FREQ=YEARLY", win("2027-02-22T00:00:00+11:00", "2027-03-08T00:00:00+11:00")), []);
      assert.deepEqual(sy("20240229", "FREQ=YEARLY", win("2028-02-22T00:00:00+11:00", "2028-03-08T00:00:00+11:00")), ["2028-02-29T00:00:00+11:00"]);
    });
    it("monthly on a day number, skipping months without it", () => {
      assert.deepEqual(sy("20261031T090000", "FREQ=MONTHLY", wide), ["2026-10-31T09:00:00+11:00", "2026-12-31T09:00:00+11:00", "2027-01-31T09:00:00+11:00"]);
      assert.deepEqual(sy("20260901T090000", "FREQ=MONTHLY;BYMONTHDAY=18", wide), ["2026-11-18T09:00:00+11:00", "2026-12-18T09:00:00+11:00", "2027-01-18T09:00:00+11:00"]);
    });
    it("second Tuesday and last Friday", () => {
      assert.deepEqual(sy("20261110T090000", "FREQ=MONTHLY;BYDAY=2TU", wide), ["2026-11-10T09:00:00+11:00", "2026-12-08T09:00:00+11:00", "2027-01-12T09:00:00+11:00"]);
      assert.deepEqual(sy("20261127T090000", "FREQ=MONTHLY;BYDAY=-1FR", wide), ["2026-11-27T09:00:00+11:00", "2026-12-25T09:00:00+11:00", "2027-01-29T09:00:00+11:00"]);
    });
    it("INTERVAL=2, COUNT and UNTIL", () => {
      assert.deepEqual(sy("20261116T090000", "FREQ=MONTHLY;INTERVAL=2", wide), ["2026-11-16T09:00:00+11:00", "2027-01-16T09:00:00+11:00"]);
      assert.deepEqual(sy("20260916T090000", "FREQ=MONTHLY;COUNT=2"), []);
      assert.deepEqual(sy("20260916T090000", "FREQ=MONTHLY;COUNT=3"), ["2026-11-16T09:00:00+11:00"]);
      assert.deepEqual(sy("20260916T090000", "FREQ=MONTHLY;UNTIL=20261101T000000Z"), []);
      assert.deepEqual(sy("20260916T090000", "FREQ=MONTHLY;UNTIL=20261201T000000Z"), ["2026-11-16T09:00:00+11:00"]);
    });
    it("EXDATE removes one monthly occurrence", () => {
      assert.deepEqual(sy("20260916T090000", "FREQ=MONTHLY", WEEK, ["EXDATE;TZID=Australia/Sydney:20261116T090000"]), []);
    });
    it("keeps 09:00 local on both sides of the daylight-saving changes", () => {
      const all = win("2026-09-01T00:00:00+10:00", "2026-11-01T00:00:00+11:00");
      assert.deepEqual(sy("20260915T090000", "FREQ=MONTHLY", all), ["2026-09-15T09:00:00+10:00", "2026-10-15T09:00:00+11:00"]);
      const apr = win("2026-03-01T00:00:00+11:00", "2026-05-01T00:00:00+10:00");
      assert.deepEqual(sy("20260315T090000", "FREQ=MONTHLY", apr), ["2026-03-15T09:00:00+11:00", "2026-04-15T09:00:00+10:00"]);
    });
    it("a 1995 start without COUNT jumps to the window, quickly", { timeout: 5000 }, () => {
      assert.equal(sy("19950118T090000", "FREQ=MONTHLY").length, 1);
      assert.equal(sy("19950118T090000", "FREQ=MONTHLY;BYDAY=3WE;COUNT=999999").length, 1);
    });
  });
  it("a title is cut at 120 code points with an ellipsis, and the id is a short key, not the UID", () => {
    const long = "🎂".repeat(130);
    const [e] = run(cal(vevent("UID:secret-uid-value", MON9, MON9END, `SUMMARY:${long}`)));
    assert.equal(Array.from(e.title!).length, 120);
    assert.ok(e.title!.endsWith("…"));
    assert.match(e.id, /^[0-9a-f]{12}$/);
    assert.equal(run(cal(vevent("UID:ok", MON9, MON9END, "SUMMARY:short")))[0].title, "short");
  });
  it("the title cap never splits a joined emoji, and a plain long title is cut as before", () => {
    const fam = "👨‍👩‍👧‍👦";
    const title = (s: string) => run(cal(vevent("UID:t", MON9, MON9END, `SUMMARY:${s}`)))[0].title;
    assert.equal(title("a".repeat(118) + fam + " and more"), "a".repeat(118) + fam + "…"); // emoji is the 119th character: kept whole
    assert.equal(title("a".repeat(119) + fam + " and more"), "a".repeat(119) + "…"); // 120th: dropped whole, never half
    assert.equal(title("b".repeat(200)), "b".repeat(119) + "…");
  });
  it("two events with no UID at the same start stay two events with different ids", () => {
    const r = run(cal(vevent(MON9, MON9END, "SUMMARY:a"), vevent(MON9, MON9END, "SUMMARY:b")));
    assert.equal(r.length, 2);
    assert.notEqual(r[0].id, r[1].id);
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

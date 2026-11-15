import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agendaView, wallTime, type AgendaView } from "./kiosk-agenda.ts";
import type { CalendarEvent } from "./calendar-ics.ts";

// Device-local construction (the model buckets by the device zone), so every case holds under any TZ.
const D = 16; // "today" is 16 Nov 2026
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
let n = 0;
const ev = (title: string | null, start: number, end: number, o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `e${n++}`, title, busy: false, allDay: false, start: new Date(start).toISOString(), end: new Date(end).toISOString(), ...o,
});
const hour = (day: number, h: number, m = 0, title = "x", len = 60) => ev(title, at(day, h, m), at(day, h, m) + len * 60_000);
const allDay = (day: number, title: string, days = 1) => ev(title, at(day, 0), at(day + days, 0), { allDay: true });
const view = (events: CalendarEvent[], now: number): AgendaView => {
  const v = agendaView(events, now);
  assert.ok(v, "expected a view");
  return v;
};

describe("kiosk agenda: worked examples", () => {
  it("6 today and 4 tomorrow at 11:00", () => {
    const events = [
      hour(D, 12, 30, "Lunch with Ana"), hour(D, 14, 0, "School pickup"), hour(D, 15, 15, "Piano"),
      hour(D, 16, 0, "Swim"), hour(D, 17, 0, "Book club"), hour(D, 18, 0, "Call with Gran"),
      hour(D + 1, 9, 0, "Dentist"), hour(D + 1, 10, 0, "a"), hour(D + 1, 11, 0, "b"), hour(D + 1, 12, 0, "c"),
    ];
    const v = view(events, at(D, 11));
    assert.deepEqual(v.pane, { caption: "NEXT UP", figure: "12:30", period: "pm", title: "Lunch with Ana", dim: false, till: null, more: "and 5 more today · 4 tomorrow" });
    assert.deepEqual(v.rows.map((r) => [r.day, r.time, r.title]), [["Today", "12:30 pm", "Lunch with Ana"], [null, "2:00 pm", "School pickup"], [null, "3:15 pm", "Piano"]]);
    assert.equal(v.more, "and 3 more today · 4 tomorrow");
  });

  it("crowded at 18:30: on now leads, two now rows, then the next time", () => {
    const events = [
      hour(D, 16, 0, "Swim lesson", 165), hour(D, 18, 30, "Book club", 60), hour(D, 19, 15, "Call with Gran", 30),
      hour(D, 20, 0, "Pick up Mika", 30), hour(D + 1, 9, 0, "Dentist"),
    ];
    const v = view(events, at(D, 18, 30));
    assert.deepEqual(v.pane, { caption: "ON NOW", figure: "Now", period: null, title: "Swim lesson", dim: false, till: "till 6:45 pm", more: "and 3 more today · 1 tomorrow" });
    assert.deepEqual(v.rows.map((r) => [r.day, r.time, r.title, r.till]), [
      ["Today", "now", "Swim lesson", "till 6:45 pm"], [null, "now", "Book club", "till 7:30 pm"], [null, "7:15 pm", "Call with Gran", null],
    ]);
    assert.equal(v.more, "and 1 more today · 1 tomorrow");
  });
});

describe("kiosk agenda: second line and caption", () => {
  const more = (events: CalendarEvent[], now = at(D, 8)) => view(events, now).pane.more;
  it("each count shape", () => {
    assert.equal(more([hour(D, 9), hour(D, 10), hour(D, 11), hour(D + 1, 9)]), "and 2 more today · 1 tomorrow");
    assert.equal(more([hour(D, 9), hour(D, 10), hour(D, 11)]), "and 2 more today");
    assert.equal(more([hour(D, 9), hour(D + 1, 9)]), "and 1 more tomorrow");
    assert.equal(more([hour(D, 9)]), null);
  });
  it("Standard more row shapes", () => {
    const today = [hour(D, 9), hour(D, 10), hour(D, 11), hour(D, 12), hour(D, 13)];
    assert.equal(view(today, at(D, 8)).more, "and 2 more today");
    const tomorrow = [hour(D, 9), hour(D, 10), hour(D, 11), hour(D + 1, 9)];
    assert.equal(view(tomorrow, at(D, 8)).more, "and 1 more tomorrow");
    assert.equal(view([hour(D, 9), hour(D, 10), hour(D, 11)], at(D, 8)).more, null);
  });
  it("captions: next up, on now, tomorrow, and no view", () => {
    assert.equal(view([hour(D, 9)], at(D, 8)).pane.caption, "NEXT UP");
    assert.equal(view([hour(D, 9)], at(D, 9, 30)).pane.caption, "ON NOW");
    const t = view([hour(D, 9), hour(D + 1, 9, 0, "Dentist")], at(D, 10, 30));
    assert.equal(t.pane.caption, "TOMORROW");
    assert.deepEqual(t.rows.map((r) => [r.day, r.time, r.title]), [["Tomorrow", "9:00 am", "Dentist"]]);
    assert.equal(agendaView([], at(D, 8)), null);
    assert.equal(agendaView([hour(D, 9)], at(D, 10, 30)), null);
  });
});

describe("kiosk agenda: event rules", () => {
  it("all-day sorts first and leads only when no timed event is on or ahead today", () => {
    const withTimed = view([allDay(D, "Holiday"), hour(D, 9, 0, "Dentist")], at(D, 8));
    assert.equal(withTimed.pane.title, "Dentist");
    assert.deepEqual(withTimed.rows.map((r) => [r.time, r.title]), [["All day", "Holiday"], ["9:00 am", "Dentist"]]);
    const alone = view([allDay(D, "Holiday"), hour(D, 9, 0, "Dentist")], at(D, 10, 30));
    assert.equal(alone.pane.title, "Holiday");
    assert.equal(alone.pane.figure, "All day");
    assert.equal(alone.pane.caption, "NEXT UP");
  });
  it("drops an ended event when now passes its end", () => {
    const e = hour(D, 9, 0, "Early", 30);
    assert.equal(view([e, hour(D, 11)], at(D, 9, 29)).rows.length, 2);
    assert.equal(view([e, hour(D, 11)], at(D, 9, 30)).rows.length, 1);
  });
  it("multi-day: now and till a weekday, All day on tomorrow", () => {
    const trip = ev("Camping", at(D - 1, 10), at(D + 3, 11));
    const v = view([trip], at(D, 12));
    assert.equal(v.rows[0].time, "now");
    assert.match(v.rows[0].till ?? "", /^till (Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
    assert.equal(v.rows[1].time, "All day");
    assert.equal(v.rows[1].day, "Tomorrow");
    assert.equal(v.pane.more, null); // the lead is not counted again on tomorrow
    const ends = ev("Conference", at(D - 1, 10), at(D, 11));
    assert.equal(view([ends], at(D, 8)).rows[0].till, "till 11:00 am");
    assert.equal(view([ends], at(D, 8)).rows.length, 1);
  });
  it("same start time: both show, first by title leads, the other is counted", () => {
    const v = view([hour(D, 9, 0, "Alpha"), hour(D, 9, 0, "Beta")], at(D, 8));
    assert.deepEqual(v.rows.map((r) => [r.time, r.title]), [["9:00 am", "Alpha"], ["9:00 am", "Beta"]]);
    assert.equal(v.pane.title, "Alpha");
    assert.equal(v.pane.more, "and 1 more today");
  });
  it("busy and untitled", () => {
    const v = view([ev(null, at(D, 9), at(D, 10), { busy: true }), ev(null, at(D, 11), at(D, 12))], at(D, 8));
    assert.deepEqual(v.rows.map((r) => [r.title, r.dim]), [["Busy", true], ["No title", true]]);
    assert.deepEqual([v.pane.title, v.pane.dim], ["Busy", true]);
  });
  it("a long title is passed whole (truncation is CSS)", () => {
    const t = "Parent-teacher interviews at Bellwood Primary";
    assert.equal(view([hour(D, 9, 0, t)], at(D, 8)).rows[0].title, t);
  });
});

describe("kiosk agenda: time strings", () => {
  it("12:00 pm, 12:00 am and 9:05 am", () => {
    assert.equal(wallTime(new Date(2026, 10, 16, 12, 0)), "12:00 pm");
    assert.equal(wallTime(new Date(2026, 10, 16, 0, 0)), "12:00 am");
    assert.equal(wallTime(new Date(2026, 10, 16, 9, 5)), "9:05 am");
  });
});

describe("kiosk agenda: the device zone decides the day", () => {
  // 22:00 UTC on the 16th is 09:00 on the 17th in Sydney; the event is 01:00 UTC on the 17th (noon there).
  const now = Date.UTC(2026, 10, 16, 22, 0);
  const e = ev("Lunch", Date.UTC(2026, 10, 17, 1, 0), Date.UTC(2026, 10, 17, 2, 0));
  it("UTC: tomorrow", () => {
    const v = agendaView([e], now, "UTC");
    assert.equal(v?.pane.caption, "TOMORROW");
    assert.equal(v?.rows[0].day, "Tomorrow");
  });
  it("Sydney: later today", () => {
    const v = agendaView([e], now, "Australia/Sydney");
    assert.equal(v?.pane.caption, "NEXT UP");
    assert.equal(v?.rows[0].day, "Today");
  });
});

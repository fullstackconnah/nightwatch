import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { inspect } from "node:util";
import { loadConfigForSave, saveConfig, type AppConfig } from "./config.ts";
import {
  CALENDAR_PROBLEM_COPY, MAX_CALENDAR_BYTES, applyCalendar, calendarMeta, commitCalendar, fetchCalendar,
  getCalendarResponse, prepareCalendar, resetCalendarCache, type CalendarResponse,
} from "./calendar-feed.ts";
import { sanitizeConfig } from "./settings/public-config.ts";

// Synthetic feeds only, and no link is ever written whole: built from words at run time.
const link = (...parts: string[]) => parts.join("");
const LINK = link("https://", "calendar", ".", "example", "/", "private", "-", "token", ".ics?key=", "wordsonly");
const LINK2 = link("https://", "other", ".", "example", "/", "second", "-", "token", ".ics?key=", "morewords");
const SYD = "Australia/Sydney";
const NOW = Date.parse("2026-11-16T10:00:00+11:00"); // a Monday
const MIN = 60_000;

const cal = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR", ""].join("\r\n");
const ev = (title: string, start: string, end: string, extra = "") => {
  const allDay = start.length === 8;
  const dt = (n: string, v: string) => (allDay ? `${n};VALUE=DATE:${v}` : `${n};TZID=${SYD}:${v}`);
  return ["BEGIN:VEVENT", `UID:${title}`, dt("DTSTART", start), dt("DTEND", end), `SUMMARY:${title}`, extra, "END:VEVENT"].filter(Boolean).join("\r\n");
};
const FEED = cal(
  ev("Standup", "20261116T090000", "20261116T100000"),
  ev("Alpha", "20261116T090000", "20261116T093000"),
  ev("Birthday", "20261116", "20261117"),
  ev("Dentist", "20261117T150000", "20261117T160000"),
  ev("Later", "20261118T090000", "20261118T100000"),
  ev("Yesterday", "20261115", "20261116"),
  ev("Late", "20261115T230000", "20261116T010000"),
  ev("NextWeek", "20261120T090000", "20261120T100000"),
  ev("TooFar", "20261123T090000", "20261123T100000"),
);

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let handler: (url: string, init: RequestInit) => Promise<Response> = async () => new Response(FEED);
const reply = (text: string, status = 200) => async () => new Response(text, { status });
const reject = (e: unknown) => async (): Promise<Response> => { throw e; };

const dir = mkdtempSync(join(tmpdir(), "nw-cal-"));
const realFetch = globalThis.fetch;
const setCfg = (patch: Partial<AppConfig>) => saveConfig({ ...loadConfigForSave(), ...patch });
const withLink = (url: string) => setCfg({ display: { timezone: SYD }, calendar: { url, updatedAt: "2026-11-01T00:00:00.000Z" } });
const ok = (r: CalendarResponse) => (r.status === "ok" ? r : assert.fail(`expected ok, got ${r.status}`));
const titles = (r: CalendarResponse) => ok(r).events.map((e) => e.title);

before(() => {
  process.env.DATA_DIR = dir;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  calls = [];
  handler = async () => new Response(FEED);
  resetCalendarCache();
  rmSync(join(dir, "config.json"), { force: true });
  withLink(LINK);
});

describe("fetchCalendar", () => {
  const problem = async (h: typeof handler) => {
    handler = h;
    const r = await fetchCalendar(LINK, SYD, NOW);
    return "problem" in r ? r.problem : "ok";
  };
  it("never follows a redirect: manual, no-store, a timeout signal, one call", async () => {
    assert.equal(await problem(reply("", 302)), "unreachable");
    assert.equal(await problem(reply("", 301)), "unreachable");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, LINK);
    assert.equal(calls[0].init.redirect, "manual");
    assert.equal(calls[0].init.cache, "no-store");
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });
  it("401, 403, 404 and 410 are refused; 500 and a failed request are unreachable", async () => {
    for (const s of [401, 403, 404, 410]) assert.equal(await problem(reply("", s)), "refused", String(s));
    assert.equal(await problem(reply("", 500)), "unreachable");
    assert.equal(await problem(reply("", 429)), "unreachable");
    assert.equal(await problem(reject(Object.assign(new Error("slow"), { name: "TimeoutError" }))), "unreachable");
    assert.equal(await problem(reject(new Error("getaddrinfo ENOTFOUND"))), "unreachable");
  });
  it("a body that does not start with BEGIN:VCALENDAR is not a calendar; a BOM and spaces are fine", async () => {
    assert.equal(await problem(reply("<html>sign in</html>")), "not-calendar");
    assert.equal(await problem(reply("")), "not-calendar");
    assert.equal(await problem(reply("﻿ \r\n" + FEED)), "ok");
  });
  it("a body over the cap is too large, measured while streaming and not from the length header", async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024).fill(65);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { pulls++; c.enqueue(chunk); },
      cancel() { cancelled = true; },
    });
    assert.equal(MAX_CALENDAR_BYTES, 5 * 1024 * 1024);
    assert.equal(await problem(async () => new Response(stream, { headers: { "content-length": "10" } })), "too-large");
    assert.equal(cancelled, true);
    assert.ok(pulls <= 8, `pulled ${pulls} chunks`);
  });
  it("returns the week count, the kept days and the covered end", async () => {
    const r = await fetchCalendar(LINK, SYD, NOW);
    if ("problem" in r) return assert.fail(r.problem);
    assert.equal(r.week, 7);
    assert.equal(r.at, NOW);
    assert.equal(r.end, Date.parse("2026-11-19T00:00:00+11:00"));
    assert.deepEqual(r.kept.map((e) => e.title).sort(), ["Alpha", "Birthday", "Dentist", "Late", "Later", "Standup"]);
  });
});

describe("getCalendarResponse", () => {
  it("says unconfigured with no link, and fetches nothing", async () => {
    rmSync(join(dir, "config.json"), { force: true });
    saveConfig({ ...loadConfigForSave(), calendar: undefined });
    assert.deepEqual(await getCalendarResponse(NOW), { status: "unconfigured" });
    assert.equal(calls.length, 0);
  });
  it("serves exactly [today 00:00, day after tomorrow 00:00): all-day first, then start, then title", async () => {
    const r = ok(await getCalendarResponse(NOW));
    assert.deepEqual(r.events.map((e) => e.title), ["Birthday", "Late", "Alpha", "Standup", "Dentist"]);
    assert.equal(r.stale, false);
    assert.equal(r.fetchedAt, new Date(NOW).toISOString());
    assert.deepEqual([r.events[0].allDay, r.events[0].start, r.events[0].end], [true, "2026-11-16T00:00:00+11:00", "2026-11-17T00:00:00+11:00"]);
  });
  it("caches for 15 minutes and shares one in-flight fetch", async () => {
    await Promise.all([getCalendarResponse(NOW), getCalendarResponse(NOW), getCalendarResponse(NOW + 1)]);
    assert.equal(calls.length, 1);
    await getCalendarResponse(NOW + 14 * MIN);
    assert.equal(calls.length, 1);
    await getCalendarResponse(NOW + 16 * MIN);
    assert.equal(calls.length, 2);
  });
  it("a failed refresh serves the last list as stale and waits a minute before trying again", async () => {
    await getCalendarResponse(NOW);
    handler = reject(new Error("down"));
    const t1 = NOW + 16 * MIN;
    const stale = ok(await getCalendarResponse(t1));
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.events.map((e) => e.title), ["Birthday", "Late", "Alpha", "Standup", "Dentist"]);
    assert.equal(calls.length, 2);
    await getCalendarResponse(t1 + 30_000);
    assert.equal(calls.length, 2);
    await getCalendarResponse(t1 + 61_000);
    assert.equal(calls.length, 3);
  });
  it("never fetched OK is an error, and it is not hammered", async () => {
    handler = reject(new Error("down"));
    assert.deepEqual(await getCalendarResponse(NOW), { status: "error" });
    assert.deepEqual(await getCalendarResponse(NOW + 30_000), { status: "error" });
    assert.equal(calls.length, 1);
    handler = async () => new Response(FEED);
    assert.equal((await getCalendarResponse(NOW + 61_000)).status, "ok");
  });
  it("answers error once the last good list no longer covers tomorrow (the second local midnight after the fetch)", async () => {
    await getCalendarResponse(NOW);
    handler = reject(new Error("down"));
    assert.equal(ok(await getCalendarResponse(Date.parse("2026-11-17T10:00:00+11:00"))).stale, true);
    assert.deepEqual(await getCalendarResponse(Date.parse("2026-11-18T10:00:00+11:00")), { status: "error" });
  });
  it("is bound to the link: a changed or cleared link never serves the old list", async () => {
    await getCalendarResponse(NOW);
    withLink(LINK2);
    handler = reject(new Error("down"));
    assert.deepEqual(await getCalendarResponse(NOW + 1000), { status: "error" });
    assert.equal(calls.at(-1)?.url, LINK2);
    handler = async () => new Response(cal(ev("Fresh", "20261116T120000", "20261116T130000")));
    assert.deepEqual(titles(await getCalendarResponse(NOW + 62_000)), ["Fresh"]);
  });
});

describe("calendarMeta", () => {
  it("reports the cache, never the link", async () => {
    assert.deepEqual(calendarMeta(loadConfigForSave()), { configured: true, updatedAt: "2026-11-01T00:00:00.000Z", lastSyncAt: null, eventsThisWeek: null, problem: null });
    await getCalendarResponse(NOW);
    const good = calendarMeta(loadConfigForSave());
    assert.deepEqual([good.lastSyncAt, good.eventsThisWeek, good.problem], [new Date(NOW).toISOString(), 7, null]);
    handler = reply("", 403);
    await getCalendarResponse(NOW + 16 * MIN);
    const bad = calendarMeta(loadConfigForSave());
    assert.deepEqual([bad.lastSyncAt, bad.eventsThisWeek, bad.problem], [new Date(NOW).toISOString(), 7, "refused"]);
    assert.deepEqual(calendarMeta({ ...loadConfigForSave(), calendar: undefined }), { configured: false, updatedAt: null, lastSyncAt: null, eventsThisWeek: null, problem: null });
  });
});

describe("the link never leaks", () => {
  it("is in no response, meta, sanitized config or console line on any failure path", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((m) => mock.method(console, m, () => {}));
    const seen: string[] = [];
    const paths: Array<typeof handler> = [
      reject(new Error(`connect failed for ${LINK}`)),
      reply(`<html>${LINK}</html>`),
      reply(`${LINK} gone`, 404),
      reply(`${LINK} broke`, 500),
      async () => new Response(new Uint8Array(MAX_CALENDAR_BYTES + 10)),
      async () => new Response(FEED),
    ];
    for (const [i, h] of paths.entries()) {
      handler = h;
      const t = NOW + i * 20 * MIN;
      seen.push(JSON.stringify(await getCalendarResponse(t)));
      seen.push(JSON.stringify(calendarMeta(loadConfigForSave())));
      seen.push(JSON.stringify(sanitizeConfig(loadConfigForSave())));
      resetCalendarCache();
      const p = await prepareCalendar({ url: LINK2 }, t);
      seen.push(JSON.stringify("error" in p ? p : { saved: p.kind }));
    }
    handler = reject(new Error(`bad ${LINK2}`));
    seen.push(JSON.stringify(await prepareCalendar({ url: LINK2 }, NOW)));
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => inspect(c.arguments, { depth: 6 })));
    for (const s of spies) s.mock.restore();
    for (const out of [...seen, ...logged]) {
      assert.ok(!out.includes("wordsonly") && !out.includes("morewords") && !out.includes("private-token"), out.slice(0, 120));
    }
  });
});

describe("saving a calendar link", () => {
  const route = async (value: unknown) => {
    const change = await prepareCalendar(value, NOW);
    if ("error" in change) return change;
    saveConfig(applyCalendar(loadConfigForSave(), change, "2026-11-16T00:00:00.000Z"));
    commitCalendar(change);
    return change;
  };
  const savedUrl = () => loadConfigForSave().calendar?.url;

  it("a bad link is refused before any fetch, with the fixed copy", async () => {
    const r = await route({ url: "nope" });
    assert.deepEqual(r, { error: "That isn't a link. Paste the whole private link from your calendar's sharing settings." });
    assert.equal(calls.length, 0);
    assert.equal(savedUrl(), LINK);
  });
  it("a failed check stores nothing and keeps the old link and its cache", async () => {
    await getCalendarResponse(NOW);
    const before = calls.length;
    for (const [h, key] of [[reply("", 404), "refused"], [reply("", 500), "unreachable"], [reply("<p>hi</p>"), "not-calendar"]] as const) {
      handler = h;
      assert.deepEqual(await route({ url: LINK2 }), { error: CALENDAR_PROBLEM_COPY[key] });
      assert.equal(savedUrl(), LINK);
    }
    assert.equal(calls.length, before + 3);
    handler = reject(new Error("down"));
    assert.ok(titles(await getCalendarResponse(NOW + 5 * MIN)).includes("Dentist"));
    assert.equal(calls.length, before + 3);
    assert.match(CALENDAR_PROBLEM_COPY["too-large"], /too large/);
  });
  it("a good save fetches once, replaces the link and the cache, and rewrites the app scheme", async () => {
    handler = async () => new Response(cal(ev("Fresh", "20261116T120000", "20261116T130000")));
    const r = await route({ url: `  ${LINK2.replace("https:", "webcal:")}  ` });
    assert.ok(!("error" in r));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, LINK2);
    assert.equal(savedUrl(), LINK2);
    assert.equal(loadConfigForSave().calendar?.updatedAt, "2026-11-16T00:00:00.000Z");
    handler = reject(new Error("must not refetch"));
    assert.deepEqual(titles(await getCalendarResponse(NOW + MIN)), ["Fresh"]);
    assert.equal(calls.length, 1);
  });
  it("null clears the link and the cache; blank keeps both", async () => {
    await getCalendarResponse(NOW);
    const n = calls.length;
    await route({ url: "   " });
    await route({});
    assert.equal(calls.length, n);
    assert.equal(savedUrl(), LINK);
    assert.ok(titles(await getCalendarResponse(NOW + MIN)).includes("Dentist"));
    await route(null);
    assert.equal(savedUrl(), undefined);
    assert.deepEqual(await getCalendarResponse(NOW + 2 * MIN), { status: "unconfigured" });
  });
  it("a settings change saved by another caller while the calendar is fetched survives the save", async () => {
    let release: (r: Response) => void = () => {};
    handler = () => new Promise<Response>((res) => { release = res; });
    const pending = route({ url: LINK2 });
    await new Promise((r) => setTimeout(r, 10));
    setCfg({ display: { timezone: SYD, place: "Elsewhere" } });
    release(new Response(FEED));
    await pending;
    assert.equal(loadConfigForSave().display?.place, "Elsewhere");
    assert.equal(savedUrl(), LINK2);
  });
});

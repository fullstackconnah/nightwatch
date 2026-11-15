/* The kiosk calendar's server side: fetch the private feed, keep it in memory for every caller, and answer the kiosk and settings.
 * The link is a secret: no caught error, status text or body is ever logged or returned (each can contain the link), so this file
 * has no console call and every failure collapses to one of four fixed problems. Relative imports only, so node:test loads it. */
import { loadConfig, type AppConfig } from "./config.ts";
import { addDays, eventOverlaps, parseIcs, startOfDay, type CalendarEvent } from "./calendar-ics.ts";
import { calendarLinkError, normalizeCalendarLink } from "./settings-checks.ts";

export type { CalendarEvent };
export type CalendarProblem = "unreachable" | "refused" | "not-calendar" | "too-large";
export type CalendarResponse =
  | { status: "unconfigured" }
  | { status: "error" }
  | { status: "ok"; stale: boolean; fetchedAt: string; events: CalendarEvent[] };
/** One good fetch: the first 3 local days for the kiosk, the next 7 counted for settings. */
export interface Fetched { at: number; kept: CalendarEvent[]; end: number; week: number }
export type CalendarChange = { kind: "clear" } | { kind: "keep" } | { kind: "set"; url: string; fetched: Fetched };

export const MAX_CALENDAR_BYTES = 5 * 1024 * 1024;
export const MAX_CALENDAR_EVENTS = 200; // the kiosk route is public and polled; one huge repeating event must not be served whole
const FETCH_TIMEOUT_MS = 10_000;
const REFRESH_MS = 15 * 60_000;
const RETRY_MS = 60_000; // after a failure; the public kiosk route must not be able to hammer the upstream
const DEFAULT_ZONE = "Australia/Sydney"; // house default, as in kiosk/api/list/tz.ts

/** Fixed copy for the settings card; nothing from the upstream is ever shown. */
export const CALENDAR_PROBLEM_COPY: Record<CalendarProblem, string> = {
  refused: "The calendar refused that link. It may have been reset; copy a fresh private link.",
  unreachable: "Couldn't reach the calendar. Check the link, or try again in a minute.",
  "not-calendar": "That link opened, but it isn't a calendar. Copy the private calendar link, not the calendar's page.",
  "too-large": "That calendar is too large to read.",
};

function zoneOf(config: AppConfig): string {
  const tz = config.display?.timezone || DEFAULT_ZONE;
  return isZone(tz) ? tz : DEFAULT_ZONE;
}
function isZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The body as text, or null once it passes the cap. Counted as chunks arrive; the length header is not trusted. */
async function readBody(res: Response): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.byteLength;
    if (got > MAX_CALENDAR_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchCalendar(url: string, tz: string, now: number): Promise<Fetched | { problem: CalendarProblem }> {
  try {
    // Never follow a redirect: the link is a secret and a redirect could send it, or us, somewhere else.
    const res = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) await res.body?.cancel().catch(() => {}); // the early returns below leave the body unread
    if ([401, 403, 404, 410].includes(res.status)) return { problem: "refused" };
    if (!res.ok) return { problem: "unreachable" }; // includes every 3xx
    const text = await readBody(res);
    if (text === null) return { problem: "too-large" };
    if (!text.trimStart().startsWith("BEGIN:VCALENDAR")) return { problem: "not-calendar" };
    const day0 = startOfDay(tz, now);
    const end = addDays(tz, day0, 4); // one day more than the route serves, so a wall left open over midnight still has its new third day
    const week = parseIcs(text, day0, addDays(tz, day0, 7), tz);
    const kept = week.filter((e) => eventOverlaps(e, day0, end)).sort(byAgenda).slice(0, MAX_CALENDAR_EVENTS);
    return { at: now, kept, end, week: week.length };
  } catch {
    return { problem: "unreachable" };
  }
}

type Entry = { url: string; tz: string; good: Fetched | null; problem: CalendarProblem | null; failedAt: number; inflight: Promise<void> | null };
// On globalThis so every route bundle shares one cache (house pattern, see cache.ts).
const g = globalThis as unknown as { __calendarFeed?: { entry: Entry | null } };
const state = (g.__calendarFeed ??= { entry: null }); // entry is bound to the link it was fetched with

function refresh(e: Entry, tz: string, now: number): Promise<void> {
  return (e.inflight ??= fetchCalendar(e.url, tz, now)
    .then((r) => {
      if ("problem" in r) { e.problem = r.problem; e.failedAt = now; }
      else { e.good = r; e.problem = null; e.failedAt = 0; }
    })
    .finally(() => { e.inflight = null; }));
}

const byAgenda = (a: CalendarEvent, b: CalendarEvent) =>
  Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start) || (a.title ?? "").localeCompare(b.title ?? "") || a.id.localeCompare(b.id);

/** What the kiosk shows: [today 00:00, three days on 00:00) in the display zone; the client only uses today and tomorrow, and the third day covers a wall left open over midnight. A good copy is served at once and refreshed in the background. */
export async function getCalendarResponse(now = Date.now()): Promise<CalendarResponse> {
  const config = loadConfig();
  const url = config.calendar?.url;
  if (!url) {
    state.entry = null;
    return { status: "unconfigured" };
  }
  const tz = zoneOf(config);
  // the saved events were cut at the start of day in the zone they were fetched for, so a zone change resets like a link change
  if (state.entry?.url !== url || state.entry.tz !== tz) state.entry = { url, tz, good: null, problem: null, failedAt: 0, inflight: null };
  const e = state.entry;
  const due = !e.good || now - e.good.at >= REFRESH_MS;
  if (due && (e.inflight || !e.failedAt || now - e.failedAt >= RETRY_MS)) {
    const fetching = refresh(e, tz, now); // never rejects: fetchCalendar catches everything
    // with a good copy that still covers the days it is served now and the next request sees the result; one that no longer covers them waits for the fetch
    if (!e.good || addDays(tz, startOfDay(tz, now), 3) > e.good.end) await fetching;
  }
  if (state.entry !== e) return getCalendarResponse(now); // the link changed while we waited
  const from = startOfDay(tz, now);
  const to = addDays(tz, from, 3);
  // A list fetched before the second local midnight ago no longer covers the served days: an error beats a silent zero.
  if (!e.good || to > e.good.end) return { status: "error" };
  return {
    status: "ok",
    stale: e.problem !== null,
    fetchedAt: new Date(e.good.at).toISOString(),
    events: e.good.kept.filter((ev) => eventOverlaps(ev, from, to)).sort(byAgenda),
  };
}

/** For the settings card: the cache's state, never the link. Reads only; it never triggers a fetch. */
export function calendarMeta(config: AppConfig) {
  const url = config.calendar?.url;
  const e = state.entry && state.entry.url === url ? state.entry : null;
  return {
    configured: Boolean(url),
    updatedAt: config.calendar?.updatedAt ?? null,
    lastSyncAt: e?.good ? new Date(e.good.at).toISOString() : null,
    eventsThisWeek: e?.good?.week ?? null,
    problem: e?.problem ?? null,
  };
}

/**
 * Save is the test. Run this BEFORE the config is loaded for the save: the check can take 10 s, and a settings save made
 * meanwhile by another request must not be overwritten. Touches neither the config nor the cache.
 */
export async function prepareCalendar(value: unknown, now = Date.now()): Promise<CalendarChange | { error: string }> {
  if (value === null) return { kind: "clear" };
  const raw = typeof (value as { url?: unknown } | undefined)?.url === "string" ? (value as { url: string }).url.trim() : "";
  if (!raw) return { kind: "keep" }; // blank keeps the saved link
  const bad = calendarLinkError(raw);
  if (bad) return { error: bad };
  const url = normalizeCalendarLink(raw);
  const r = await fetchCalendar(url, zoneOf(loadConfig()), now);
  return "problem" in r ? { error: CALENDAR_PROBLEM_COPY[r.problem] } : { kind: "set", url, fetched: r };
}

export function applyCalendar(config: AppConfig, change: CalendarChange, updatedAt: string): AppConfig {
  const next = { ...config };
  if (change.kind === "clear") delete next.calendar;
  else if (change.kind === "set") next.calendar = { url: change.url, updatedAt };
  return next;
}

/** Call after the config is saved: the cache follows the saved link, never leads it. */
export function commitCalendar(change: CalendarChange): void {
  if (change.kind === "clear") state.entry = null;
  else if (change.kind === "set") state.entry = { url: change.url, tz: zoneOf(loadConfig()), good: change.fetched, problem: null, failedAt: 0, inflight: null };
}

export function resetCalendarCache(): void {
  state.entry = null;
}

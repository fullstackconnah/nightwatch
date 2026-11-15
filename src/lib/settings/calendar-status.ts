/* The Calendar card's one status line, from the server's cache state (never from the link). Pure, relative imports only. */
import { wallTime } from "../kiosk-agenda.ts";
import type { CalendarProblem } from "../calendar-feed.ts";

/** `integrations.calendar` from GET /api/settings. */
export interface CalendarStatus {
  configured: boolean;
  updatedAt: string | null;
  lastSyncAt: string | null;
  eventsThisWeek: number | null;
  problem: CalendarProblem | null;
}

const WHY: Record<CalendarProblem, string> = {
  unreachable: "the calendar stopped answering",
  refused: "the calendar refused the link (copy a fresh private link and Replace)",
  "not-calendar": "the link is no longer a calendar",
  "too-large": "the calendar is too large to read",
};

/** Null until the kiosk has read the calendar once (after a restart): the house "configured · last saved" line stands alone then. */
export function calendarStatusLine(s: CalendarStatus): { tone: "ok" | "warn"; text: string } | null {
  if (!s.configured || !s.lastSyncAt) return null;
  const at = new Date(s.lastSyncAt);
  if (s.problem) return { tone: "warn", text: `Not syncing since ${new Intl.DateTimeFormat("en-AU", { weekday: "short" }).format(at)} ${wallTime(at)}: ${WHY[s.problem]}.` };
  const n = s.eventsThisWeek ?? 0;
  return { tone: "ok", text: `Calendar connected · ${n === 0 ? "no events" : n === 1 ? "1 event" : `${n} events`} this week` };
}

// The kiosk calendar's words, as one pure function: the route's events, the device's "now" and zone in; the glance pane's
// lead and the Standard rows out. The server already sorted (all-day first, start, title); this only buckets by the device's
// local day, drops what has ended, and picks the lead. Pure and relative-import only, like kiosk-list.ts.
import { formatWallClock } from "./format.ts";
import type { CalendarEvent } from "./calendar-ics.ts";

export interface AgendaPane {
  caption: "NEXT UP" | "ON NOW" | "TOMORROW";
  /** "12:30", "Now" or "All day". */
  figure: string;
  /** "pm" beside a time figure, else null. */
  period: string | null;
  title: string;
  /** Busy and No title read in ink-dim. */
  dim: boolean;
  till: string | null;
  more: string | null;
}

export interface AgendaRow {
  id: string;
  /** Only on each day's first row. */
  day: "Today" | "Tomorrow" | null;
  /** "All day", "now" or "4:00 pm". */
  time: string;
  now: boolean;
  title: string;
  dim: boolean;
  till: string | null;
}

export interface AgendaView {
  pane: AgendaPane;
  rows: AgendaRow[];
  more: string | null;
}

export const AGENDA_ROWS = 3;

/** "4:00 pm", never "04:00". */
export function wallTime(d: Date): string {
  const { time, period } = formatWallClock(d);
  return `${time} ${period.toLowerCase()}`;
}

const moreLine = (today: number, tomorrow: number): string | null => {
  if (today > 0) return `and ${today} more today${tomorrow > 0 ? ` · ${tomorrow} tomorrow` : ""}`;
  return tomorrow > 0 ? `and ${tomorrow} more tomorrow` : null;
};

/** `zone` decides the day buckets (the device's own when omitted). shortcut: times are always written in the device zone, so a caller that passes another zone only moves the day buckets. */
export function agendaView(events: CalendarEvent[], now: number, zone?: string): AgendaView | null {
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const key = (ms: number) => dayFmt.format(ms);
  const today = key(now);
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);

  type Item = { e: CalendarEvent; start: number; end: number; first: string; last: string };
  const items: Item[] = events.map((e) => {
    const start = Date.parse(e.start);
    const end = Date.parse(e.end);
    return { e, start, end, first: key(start), last: key(Math.max(start, end - 1)) };
  });
  const onDay = (day: string) => items.filter((i) => i.first <= day && day <= i.last && !(day === today && !i.e.allDay && i.end <= now));
  const todayItems = onDay(today);
  const tomorrowItems = onDay(tomorrow);
  if (!todayItems.length && !tomorrowItems.length) return null;

  const title = (e: CalendarEvent) => ({ title: e.title || (e.busy ? "Busy" : "No title"), dim: !e.title });
  const till = (i: Item) => (i.last > tomorrow ? `till ${new Intl.DateTimeFormat("en-AU", { timeZone: zone, weekday: "short" }).format(i.end - 1)}` : `till ${wallTime(new Date(i.end))}`);
  const isNow = (i: Item) => !i.e.allDay && i.start <= now;

  const rows: AgendaRow[] = [
    ...todayItems.map((i, n) => ({
      id: i.e.id, day: n === 0 ? ("Today" as const) : null, now: isNow(i), ...title(i.e),
      time: i.e.allDay ? "All day" : isNow(i) ? "now" : wallTime(new Date(i.start)),
      till: isNow(i) ? till(i) : null,
    })),
    ...tomorrowItems.map((i, n) => ({
      id: `${i.e.id}:tomorrow`, day: n === 0 ? ("Tomorrow" as const) : null, now: false, ...title(i.e),
      time: i.e.allDay ? "All day" : i.first < tomorrow ? (key(i.end) === tomorrow ? `until ${wallTime(new Date(i.end))}` : "All day") : wallTime(new Date(i.start)), till: null,
    })),
  ];
  const shown = rows.slice(0, AGENDA_ROWS);
  const shownToday = Math.min(shown.length, todayItems.length);
  const more = moreLine(todayItems.length - shownToday, tomorrowItems.length - (shown.length - shownToday));

  // The lead: on now, else the next timed event today, else today's all-day, else tomorrow's first.
  const timedToday = todayItems.filter((i) => !i.e.allDay);
  const lead = timedToday.find(isNow) ?? timedToday[0] ?? todayItems[0] ?? tomorrowItems[0];
  const leadToday = todayItems.includes(lead);
  const on = leadToday && isNow(lead);
  const time = wallTime(new Date(lead.start)).split(" ");
  const showTime = !lead.e.allDay && !(on || (!leadToday && lead.first < tomorrow));
  return {
    pane: {
      caption: on ? "ON NOW" : leadToday ? "NEXT UP" : "TOMORROW",
      figure: on ? "Now" : showTime ? time[0] : "All day",
      period: showTime ? time[1] : null,
      ...title(lead.e),
      till: on ? till(lead) : null,
      // the lead is not "other", even when a multi-day lead also sits on tomorrow
      more: moreLine(todayItems.filter((i) => i !== lead).length, tomorrowItems.filter((i) => i !== lead).length),
    },
    rows: shown,
    more,
  };
}

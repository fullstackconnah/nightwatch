/* A hand-rolled iCalendar subset for the kiosk agenda: single events, DAILY and WEEKLY repeats (INTERVAL, UNTIL, COUNT,
 * EXDATE, moved occurrences, WEEKLY BYDAY) and nothing else. Any other repeat shows at its first occurrence only.
 * Pure and import-free so node:test loads it. It never throws: a bad line or event is skipped, and every expansion is bounded. */

export interface CalendarEvent {
  /** UID + occurrence start; stable across polls. */
  id: string;
  /** null when the title is empty or the event is busy-only. */
  title: string | null;
  busy: boolean;
  allDay: boolean;
  /** ISO with offset in the display zone; all-day = local 00:00. */
  start: string;
  /** ISO with offset; exclusive; all-day = next local 00:00. */
  end: string;
}

const DAY = 86_400_000;
const STEP_BUDGET = 300_000; // candidate days examined per parse, so hostile repeats cannot hang the server

// --- zone maths (Intl only; the server's own zone never matters) ---
const formatters = new Map<string, Intl.DateTimeFormat | null>();
function formatter(tz: string): Intl.DateTimeFormat | null {
  let f = formatters.get(tz);
  if (f === undefined) {
    if (formatters.size > 200) formatters.clear(); // zone names come from the feed
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    } catch {
      f = null; // unknown or Windows-style zone name
    }
    formatters.set(tz, f);
  }
  return f;
}

function zoneParts(tz: string, ms: number) {
  const p: Record<string, number> = {};
  for (const x of (formatter(tz) ?? formatter("UTC"))!.formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return p;
}
const offsetAt = (tz: string, ms: number): number => {
  const s = Math.floor(ms / 1000) * 1000;
  const p = zoneParts(tz, s);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - s;
};

/** The instant a wall-clock time shows in `tz`; the second pass settles times near a daylight-saving change. */
function wallToMs(tz: string, y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  return guess - offsetAt(tz, guess - offsetAt(tz, guess));
}

export function startOfDay(tz: string, ms: number): number {
  const p = zoneParts(tz, ms);
  return wallToMs(tz, p.year, p.month, p.day);
}
/** `ms` must be a local midnight; the result is the local midnight `n` days later. */
export function addDays(tz: string, ms: number, n: number): number {
  const p = zoneParts(tz, ms);
  return wallToMs(tz, p.year, p.month, p.day + n);
}

const p2 = (n: number) => String(n).padStart(2, "0");
function isoIn(tz: string, ms: number): string {
  const p = zoneParts(tz, ms);
  const off = Math.round(offsetAt(tz, ms) / 60_000);
  const a = Math.abs(off);
  return `${p.year}-${p2(p.month)}-${p2(p.day)}T${p2(p.hour)}:${p2(p.minute)}:${p2(p.second)}${off < 0 ? "-" : "+"}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}

// --- text ---
type Prop = { params: Record<string, string>; value: string };
type Props = Map<string, Prop[]>;

function splitOutsideQuotes(s: string, ch: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') quoted = !quoted;
    else if (s[i] === ch && !quoted) { out.push(s.slice(from, i)); from = i + 1; }
  }
  out.push(s.slice(from));
  return out;
}

function parseLine(line: string): [string, Prop] | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) { colon = i; break; }
  }
  if (colon < 1) return null;
  const [name, ...rest] = splitOutsideQuotes(line.slice(0, colon), ";");
  const params: Record<string, string> = {};
  for (const r of rest) {
    const eq = r.indexOf("=");
    if (eq > 0) params[r.slice(0, eq).toUpperCase()] = r.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return [name.trim().toUpperCase(), { params, value: line.slice(colon + 1) }];
}

const unescapeText = (v: string) => v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

// --- times ---
type Dt = { allDay: boolean; zone: string; y: number; mo: number; d: number; h: number; mi: number; s: number };

function parseDt(p: Prop, tz: string): Dt | null {
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?$/.exec(p.value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const tzid = p.params.TZID;
  return { allDay: m[4] === undefined, zone: m[7] ? "UTC" : tzid && formatter(tzid) ? tzid : tz, y, mo, d, h, mi, s: Math.min(s, 59) };
}
const dtMs = (t: Dt, tz: string) => (t.allDay ? wallToMs(tz, t.y, t.mo, t.d) : wallToMs(t.zone, t.y, t.mo, t.d, t.h, t.mi, t.s));
const dayNumber = (t: Dt) => Date.UTC(t.y, t.mo - 1, t.d) / DAY;
const weekday = (dn: number) => (((dn + 4) % 7) + 7) % 7; // 0 = Sunday; day 0 is a Thursday

function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const [w, d, h, mi, s] = m.slice(2).map((x) => Number(x ?? 0));
  const ms = (((w * 7 + d) * 24 + h) * 60 + mi) * 60_000 + s * 1000;
  return m[1] === "-" ? -ms : ms;
}

// --- repeats ---
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
type Rule = { weekly: boolean; interval: number; count?: number; until?: Dt; byday: number[] };

/** null = not one of the supported repeats, so the event shows at its first occurrence only. */
function parseRule(value: string, zone: string): Rule | null {
  const r: Record<string, string> = {};
  for (const kv of value.split(";")) {
    const eq = kv.indexOf("=");
    if (eq > 0) r[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
  }
  const weekly = r.FREQ === "WEEKLY";
  // shortcut: WKST is ignored (weeks start Monday), so a WEEKLY;INTERVAL>1;WKST=SU rule can land a week off; upgrade if one shows up.
  const extra = Object.keys(r).some((k) => !["FREQ", "INTERVAL", "COUNT", "UNTIL", "WKST", weekly ? "BYDAY" : ""].includes(k));
  if ((!weekly && r.FREQ !== "DAILY") || extra) return null;
  const byday = r.BYDAY ? r.BYDAY.split(",").map((c) => DAY_CODES.indexOf(c.toUpperCase())) : [];
  if (byday.includes(-1)) return null;
  const count = r.COUNT === undefined ? undefined : Number(r.COUNT);
  if (count !== undefined && !(Number.isInteger(count) && count >= 1)) return null;
  const interval = Number(r.INTERVAL ?? 1);
  return {
    weekly,
    interval: Number.isInteger(interval) && interval >= 1 ? interval : 1,
    count,
    until: r.UNTIL ? (parseDt({ params: {}, value: r.UNTIL }, zone) ?? undefined) : undefined,
    byday,
  };
}

// --- the parser ---
interface Ev {
  uid: string;
  title: string | null;
  busy: boolean;
  start: Dt;
  /** The repeat rule text, if any. */
  rrule?: string;
  exdates: Dt[];
  recurrenceId?: Dt;
  durMs: number;
  days: number;
}

const first = (props: Props, name: string) => props.get(name)?.[0];

function toEv(props: Props, tz: string): Ev | null {
  const startProp = first(props, "DTSTART");
  const start = startProp && parseDt(startProp, tz);
  if (!start) return null;
  const endProp = first(props, "DTEND");
  const end = endProp && parseDt(endProp, tz);
  const dur = first(props, "DURATION") && parseDuration(first(props, "DURATION")!.value);
  let durMs = 0;
  let days = 1;
  if (start.allDay) days = end?.allDay ? Math.max(1, Math.round(dayNumber(end) - dayNumber(start))) : dur ? Math.max(1, Math.ceil(dur / DAY)) : 1;
  else durMs = end ? Math.max(0, dtMs(end, tz) - dtMs(start, tz)) : dur ? Math.max(0, dur) : 0;
  const cls = first(props, "CLASS")?.value.trim().toUpperCase();
  const busy = cls === "PRIVATE" || cls === "CONFIDENTIAL";
  const summary = unescapeText(first(props, "SUMMARY")?.value ?? "").trim();
  const rid = first(props, "RECURRENCE-ID");
  return {
    uid: first(props, "UID")?.value.trim() ?? "",
    title: busy || !summary ? null : summary,
    busy,
    start,
    rrule: first(props, "RRULE")?.value,
    exdates: (props.get("EXDATE") ?? []).flatMap((p) => p.value.split(",").map((v) => parseDt({ params: p.params, value: v }, tz))).filter((t): t is Dt => t !== null),
    recurrenceId: (rid && parseDt(rid, tz)) || undefined,
    durMs,
    days,
  };
}

/** Collects the VEVENT blocks (nested components such as alarms are skipped) as property maps. */
function eventBlocks(text: string): Array<{ props: Props; cancelled: boolean }> {
  const out: Array<{ props: Props; cancelled: boolean }> = [];
  let cur: Props | null = null;
  let nested = 0;
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r\n|\n|\r/)) {
    const l = parseLine(line);
    if (!l) continue;
    const [name, prop] = l;
    if (name === "BEGIN" && prop.value.trim().toUpperCase() === "VEVENT") { cur = new Map(); nested = 0; continue; }
    if (!cur) continue;
    if (name === "BEGIN") nested++;
    else if (name === "END") {
      if (nested > 0) nested--;
      else { out.push({ props: cur, cancelled: first(cur, "STATUS")?.value.trim().toUpperCase() === "CANCELLED" }); cur = null; }
    } else if (nested === 0) cur.set(name, [...(cur.get(name) ?? []), prop]);
  }
  return out;
}

const overlapsMs = (s: number, e: number, a: number, b: number) => s < b && (e > a || s >= a);

export const eventOverlaps = (e: CalendarEvent, a: number, b: number) => overlapsMs(Date.parse(e.start), Date.parse(e.end), a, b);

/** Occurrences overlapping [winStart, winEnd) (ms), as events in `tz`. Never throws. */
export function parseIcs(text: string, winStart: number, winEnd: number, tz: string): CalendarEvent[] {
  const out = new Map<string, CalendarEvent>();
  try {
    const zone = formatter(tz) ? tz : "UTC";
    const evs: Array<{ ev: Ev; cancelled: boolean }> = [];
    for (const b of eventBlocks(text)) {
      try {
        const ev = toEv(b.props, zone);
        if (ev) evs.push({ ev, cancelled: b.cancelled });
      } catch { /* a bad event is skipped */ }
    }
    // A moved or cancelled occurrence replaces that occurrence of its repeat, whichever comes first in the feed.
    const replaced = new Set(evs.filter((e) => e.ev.recurrenceId).map((e) => `${e.ev.uid}|${dtMs(e.ev.recurrenceId!, zone)}`));
    let steps = STEP_BUDGET;

    for (const { ev, cancelled } of evs) {
      if (cancelled) continue;
      try {
        const { start } = ev;
        const emit = (s: number, e: number) => {
          if (!overlapsMs(s, e, winStart, winEnd)) return;
          const startIso = isoIn(zone, s);
          out.set(`${ev.uid}@${startIso}`, { id: `${ev.uid}@${startIso}`, title: ev.title, busy: ev.busy, allDay: start.allDay, start: startIso, end: isoIn(zone, e) });
        };
        const occurrence = (dn: number): [number, number] => {
          const d = new Date(dn * DAY);
          const [y, mo, day] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
          if (start.allDay) return [wallToMs(zone, y, mo, day), wallToMs(zone, y, mo, day + ev.days)];
          const s = wallToMs(start.zone, y, mo, day, start.h, start.mi, start.s);
          return [s, s + ev.durMs];
        };
        const startDn = dayNumber(start);
        const rule = ev.rrule && !ev.recurrenceId ? parseRule(ev.rrule, start.zone) : null;
        if (!rule) {
          const [s, e] = occurrence(startDn);
          if (!ev.exdates.some((x) => dtMs(x, zone) === s)) emit(s, e);
          continue;
        }

        const exdates = new Set(ev.exdates.map((x) => dtMs(x, zone)));
        const until = rule.until
          ? rule.until.allDay ? wallToMs(rule.until.zone, rule.until.y, rule.until.mo, rule.until.d + 1) - 1 : dtMs(rule.until, zone)
          : undefined;
        const winStartDn = Math.floor(winStart / DAY);
        const winEndDn = Math.floor(winEnd / DAY) + 2;
        const lookback = Math.ceil((start.allDay ? ev.days * DAY : ev.durMs) / DAY) + 2;
        // Without COUNT, jump straight to the window; with COUNT every earlier occurrence must be counted, cheaply (no zone maths).
        const jump = rule.count === undefined;
        const from = winStartDn - lookback;
        const offsets = (rule.byday.length ? rule.byday : [weekday(startDn)]).map((d) => (d + 6) % 7).sort((a, b) => a - b);
        const monday = startDn - ((weekday(startDn) + 6) % 7);
        function* candidates(): Generator<number> {
          if (rule!.weekly) {
            for (let w = jump ? Math.max(0, Math.floor((from - 6 - monday) / (7 * rule!.interval))) : 0; ; w++) {
              for (const o of offsets) {
                const dn = monday + 7 * rule!.interval * w + o;
                if (dn >= startDn) yield dn;
              }
            }
          }
          for (let k = jump ? Math.max(0, Math.floor((from - startDn) / rule!.interval)) : 0; ; k++) yield startDn + k * rule!.interval;
        }
        let n = 0;
        for (const dn of candidates()) {
          if (--steps < 0 || dn > winEndDn || (rule.count !== undefined && n >= rule.count)) break;
          n++;
          if (dn < from) continue;
          const [s, e] = occurrence(dn);
          if (until !== undefined && s > until) break;
          if (!exdates.has(s) && !replaced.has(`${ev.uid}|${s}`)) emit(s, e);
        }
      } catch { /* a bad event is skipped */ }
    }
  } catch { /* never throw on hostile input */ }
  return [...out.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.id < b.id ? -1 : 1));
}

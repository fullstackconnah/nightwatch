/* Bin night: the stored collection rule, its one checker, and "which evening is next". Pure and import-light so
 * node:test loads it and the settings card, the route and the kiosk all share the same words and the same maths.
 * Day maths runs on YYYY-MM-DD read as UTC dates (a whole-day count), never local milliseconds, so DST cannot move a day. */
import type { AppConfig } from "./config.ts";

export type BinCollection = {
  /** 1-20 characters after cleaning. */
  name: string;
  /** 0-6, 0 = Sunday: the collection (truck) day. */
  weekday: number;
  /** Weeks between collections. */
  every: 1 | 2;
  /** "YYYY-MM-DD" on `weekday`; present only and always when every === 2. */
  anchor?: string;
};
export type BinsConfig = { collections: BinCollection[] };
export type BinField = "name" | "weekday" | "every" | "anchor" | "bins" | "night";
/** `row` is absent for a card-level error (the count, a night too long). */
export type BinError = { row?: number; field: BinField; message: string };
export type BinCheck = { ok: true; value: BinsConfig } | { ok: false; errors: BinError[] };
export type BinNight = { date: string; bins: string[] };
export type BinsResponse = { status: "ok"; night: BinNight | null } | { status: "unconfigured" } | { status: "error" };
export type BinSegment = { text: string; name: boolean };

export const MAX_BINS = 4;
export const MAX_NAME = 20;
export const MAX_LINE = 44;
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---- dates ----
const dayNumber = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;
const isoOf = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (n: number): number => new Date(n * 86_400_000).getUTCDay();
const mod = (a: number, m: number): number => ((a % m) + m) % m;

/** A real calendar date in 2000-2099, as its day number; null for anything else (2026-02-30, 2026-2-3, 1999-01-01). */
function parseAnchor(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1];
  const n = dayNumber(s);
  return y >= 2000 && y <= 2099 && isoOf(n) === s ? n : null;
}

// ---- the sentence ----
const join = (names: string[]): BinSegment[] =>
  names.flatMap((name, i) => [...(i ? [{ text: i === names.length - 1 ? " and " : ", ", name: false }] : []), { text: name, name: true }]);

/** The wall sentence as segments (names flagged, so the wall can weigh them): "A goes out tonight", or "A tonight" when that is over 44. */
export function binLineSegments(names: string[]): BinSegment[] {
  const full = [...join(names), { text: names.length === 1 ? " goes out tonight" : " go out tonight", name: false }];
  const segs = full.map((s) => s.text).join("").length > MAX_LINE ? [...join(names), { text: " tonight", name: false }] : full;
  return [{ ...segs[0], text: segs[0].text.charAt(0).toUpperCase() + segs[0].text.slice(1) }, ...segs.slice(1)];
}
export const binLine = (names: string[]): string => binLineSegments(names).map((s) => s.text).join("");

// ---- the checker ----
// Whitespace first becomes a space (so "a<TAB>b" stays two words), then control and invisible characters go.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu; // control, format (zero-width, bidi, soft hyphen, BOM), line and paragraph separators
const cleanName = (s: string): string => s.replace(/\s+/g, " ").replace(INVISIBLE, "").replace(/ +/g, " ").trim();
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const BIN_COPY = {
  blank: "Name this bin, or remove it.",
  long: "Bin names are 20 characters at most.",
  noLetter: "Use letters or numbers in the bin name.",
  dup: "Another bin already has this name.",
  noDay: "Pick the day the truck comes.",
  noEvery: "Pick how often this bin is collected.",
  noAnchor: "Pick any date this bin is collected.",
  badAnchor: "Pick a date between 2000 and 2099.",
  tooMany: "Four bins at most.",
  none: "Add a bin, or clear the schedule.",
  shape: "The bin schedule isn't valid.",
} as const;
const anchorOff = (anchor: string, weekday: number, on: number) =>
  `${+anchor.slice(8)} ${MONTHS[+anchor.slice(5, 7) - 1]} ${anchor.slice(0, 4)} is a ${DAY_NAMES[on]}. Pick a ${DAY_NAMES[weekday]}, or change the collection day.`;

/** The nights are the days before each collection; fourteen in a row cover every weekly and fortnightly mix, wherever they start. */
const WINDOW_START = dayNumber("2026-01-05");

/** The cleaned rule, or every reason it is refused (row-level first, in card order). Unknown fields are never copied. */
export function checkBins(input: unknown): BinCheck {
  if (!isRecord(input) || !Array.isArray(input.collections)) return { ok: false, errors: [{ field: "bins", message: BIN_COPY.shape }] };
  const rows = input.collections as unknown[];
  if (rows.length === 0) return { ok: false, errors: [{ field: "bins", message: BIN_COPY.none }] };
  if (rows.length > MAX_BINS) return { ok: false, errors: [{ field: "bins", message: BIN_COPY.tooMany }] };

  const errors: BinError[] = [];
  const value: BinCollection[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, row) => {
    const r = isRecord(raw) ? raw : {};
    const name = typeof r.name === "string" ? cleanName(r.name) : "";
    const weekday = r.weekday;
    const every = r.every;
    let ok = true;
    const bad = (field: BinField, message: string) => { errors.push({ row, field, message }); ok = false; };

    if (!name) bad("name", BIN_COPY.blank);
    else if (name.length > MAX_NAME) bad("name", BIN_COPY.long);
    else if (!/[\p{L}\p{N}]/u.test(name)) bad("name", BIN_COPY.noLetter);
    else if (seen.has(name.toLowerCase())) bad("name", BIN_COPY.dup);
    seen.add(name.toLowerCase());

    const day = typeof weekday === "number" && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : null;
    if (day === null) bad("weekday", BIN_COPY.noDay);
    if (every !== 1 && every !== 2) bad("every", BIN_COPY.noEvery);

    let anchor: string | undefined;
    if (every === 2) {
      const a = typeof r.anchor === "string" ? r.anchor.trim() : "";
      const n = a ? parseAnchor(a) : null;
      if (!a) bad("anchor", BIN_COPY.noAnchor);
      else if (n === null) bad("anchor", BIN_COPY.badAnchor);
      else if (day !== null && weekdayOf(n) !== day) bad("anchor", anchorOff(a, day, weekdayOf(n)));
      else anchor = a;
    }
    if (ok && day !== null && (every === 1 || every === 2)) value.push({ name, weekday: day, every, ...(anchor ? { anchor } : {}) });
  });
  if (errors.length) return { ok: false, errors };

  const cfg: BinsConfig = { collections: value };
  for (let i = 1; i <= 14; i++) {
    const night = binsDue(cfg, WINDOW_START + i);
    const len = night.length ? binLine(night).length : 0;
    if (len > MAX_LINE) {
      const evening = DAY_NAMES[weekdayOf(WINDOW_START + i - 1)];
      return { ok: false, errors: [{ field: "night", message: `${evening} night's line is too long for the wall (${len} of ${MAX_LINE} characters). Shorten a bin name.` }] };
    }
  }
  return { ok: true, value: cfg };
}

// ---- which evening ----
/** The bins collected on day `d` (a day number), in card order. */
function binsDue(cfg: BinsConfig, d: number): string[] {
  return cfg.collections
    .filter((c) => weekdayOf(d) === c.weekday && (c.every === 1 || (c.anchor !== undefined && mod(Math.round((d - dayNumber(c.anchor)) / 7), 2) === 0)))
    .map((c) => c.name);
}

/** The first evening (today included) before a collection within the next 14 days, with its bins; null when none. `today` is YYYY-MM-DD. */
export function nextBinNight(cfg: BinsConfig, today: string): BinNight | null {
  const t = dayNumber(today);
  for (let i = 1; i <= 14; i++) {
    const bins = binsDue(cfg, t + i);
    if (bins.length) return { date: isoOf(t + i - 1), bins };
  }
  return null;
}

/** "Tuesday 17 Nov" for the settings preview. */
export const nightLabel = (date: string): string => `${DAY_NAMES[weekdayOf(dayNumber(date))]} ${+date.slice(8)} ${MONTHS[+date.slice(5, 7) - 1]}`;

// ---- the two server edges ----
/** GET /kiosk/api/bins: three shapes and nothing else. A stored rule that fails the checker is `error`, never echoed. */
export function binsPayload(stored: unknown, today: string): BinsResponse {
  if (stored === undefined) return { status: "unconfigured" };
  const c = checkBins(stored);
  return c.ok ? { status: "ok", night: nextBinNight(c.value, today) } : { status: "error" };
}

/** POST /api/settings/integrations { bins }: the config with the cleaned rule saved (or the key removed for null), every other key untouched. */
export function mergeBins(current: AppConfig, raw: unknown): { next: AppConfig } | { error: string } {
  const next: AppConfig = { ...current };
  if (raw === null) {
    delete next.bins;
    return { next };
  }
  const c = checkBins(raw);
  if (!c.ok) return { error: c.errors[0].message };
  next.bins = c.value;
  return { next };
}

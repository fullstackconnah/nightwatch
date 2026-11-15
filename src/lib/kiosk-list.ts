// Shared by the kiosk list store (server) and, later, the sheet (client): pure, relative imports only.
export type ListId = "shopping";
export interface ListItem { id: string; listId: ListId; text: string; done: boolean; createdAt: number; doneAt: number | null; updatedAt: number }
export interface AddHistory { key: string; text: string; count: number; lastAt: number }
export interface ListFile { v: 1; items: ListItem[]; history: AddHistory[] }

export const MAX_LEN = 60;
export const MAX_ITEMS = 13;
/** Hard ceiling on all rows, ticked included, so the file cannot grow without bound between 04:00 sweeps. */
export const MAX_ROWS = MAX_ITEMS * 3;
/** Full: MAX_ITEMS open items (ticked rows don't count against the cap) or MAX_ROWS rows in all. */
export const isFull = (items: { done: boolean }[]): boolean => items.filter((i) => !i.done).length >= MAX_ITEMS || items.length >= MAX_ROWS;
/** After a failed optimistic clear: put back the `gone` rows of `before` that `current` lost; rows added meanwhile stay. */
export const restoreGone = <T extends { id: string }>(current: T[], before: T[], gone: ReadonlySet<string>): T[] => {
  const have = new Set(current.map((i) => i.id));
  return [...current, ...before.filter((i) => gone.has(i.id) && !have.has(i.id))];
};
export const DEFAULT_TZ = "Australia/Sydney";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isListId = (v: unknown): v is ListId => v === "shopping";

export const norm = (s: string): string =>
  // strip first, then NFC, so the result is idempotent; zero-width/format chars (incl. ZWJ in emoji) go too
  String(s).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, "").normalize("NFC").replace(/\s+/g, " ").trim();
export const fold = (s: string): string => norm(s).toLocaleLowerCase();

export type AddCheck =
  | { kind: "blank" | "long" | "full" }
  | { kind: "dupe" | "revive"; item: { text: string; done: boolean } }
  | { kind: "add"; text: string };

/** Ported from the design lab's part.js; the one rule set for every add path. */
export function checkAdd<T extends { text: string; done: boolean }>(raw: string, items: T[]): AddCheck & { item?: T } {
  const text = norm(raw);
  if (!text) return { kind: "blank" };
  if (text.length > MAX_LEN) return { kind: "long" };
  const hit = items.find((i) => fold(i.text) === fold(text));
  if (hit) return { kind: hit.done ? "revive" : "dupe", item: hit };
  if (isFull(items)) return { kind: "full" };
  return { kind: "add", text };
}

/** Open items by createdAt desc (stable, so a same-ms add stays on top), then ticked by doneAt desc. */
export function sortItems(items: ListItem[]): ListItem[] {
  const open = items.filter((i) => !i.done).sort((a, b) => b.createdAt - a.createdAt);
  const ticked = items.filter((i) => i.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  return [...open, ...ticked];
}

function localParts(tz: string, t: number) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(t))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return p;
}
const offsetAt = (tz: string, t: number): number => {
  const s = Math.floor(t / 1000) * 1000;
  const p = localParts(tz, s);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - s;
};

/** The latest local 04:00 at or before `now` in `tz`; an invalid zone falls back to Sydney. */
export function sweepBoundary(tz: string, now: number): number {
  try {
    const p = localParts(tz, now);
    const day = p.hour < 4 ? p.day - 1 : p.day;
    const guess = Date.UTC(p.year, p.month - 1, day, 4);
    const t0 = guess - offsetAt(tz, guess);
    return guess - offsetAt(tz, t0); // second pass settles a DST edge
  } catch {
    return tz === DEFAULT_TZ ? now : sweepBoundary(DEFAULT_TZ, now);
  }
}

export const SUGGEST_DAYS = 90;
const DAY = 86400000;

/** Top 4 names by count then recency, last 90 days, not currently open. */
export function suggestions(history: AddHistory[], items: ListItem[], now: number): string[] {
  const open = new Set(items.filter((i) => !i.done).map((i) => fold(i.text)));
  return history
    .filter((h) => h.lastAt >= now - SUGGEST_DAYS * DAY && !open.has(h.key))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, 4)
    .map((h) => h.text);
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseItem(v: unknown): ListItem | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !UUID_RE.test(o.id) || !isListId(o.listId) || typeof o.text !== "string" || typeof o.done !== "boolean") return null;
  if (!o.text || o.text !== norm(o.text) || o.text.length > MAX_LEN) return null;
  if (!isNum(o.createdAt) || !isNum(o.updatedAt) || !(o.doneAt === null || isNum(o.doneAt))) return null;
  return { id: o.id.toLowerCase(), listId: o.listId, text: o.text, done: o.done, createdAt: o.createdAt, doneAt: o.doneAt, updatedAt: o.updatedAt };
}

function parseHistory(v: unknown): AddHistory | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.key !== "string" || typeof o.text !== "string" || !isNum(o.count) || !isNum(o.lastAt)) return null;
  return { key: o.key, text: o.text, count: o.count, lastAt: o.lastAt };
}

/** null when the text is not a v1 list file; malformed items or history rows are dropped one by one. */
export function parseListFile(raw: string): ListFile | null {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== "object" || (j as { v?: unknown }).v !== 1) return null;
  const o = j as { items?: unknown; history?: unknown };
  const items = (Array.isArray(o.items) ? o.items : []).map(parseItem).filter((i): i is ListItem => i !== null);
  const history = (Array.isArray(o.history) ? o.history : []).map(parseHistory).filter((h): h is AddHistory => h !== null);
  return { v: 1, items: sortItems(items).slice(0, MAX_ROWS), history }; // rows, not open items: ticked rows must not push open ones out on a read
}

/** v4-layout id from getRandomValues: crypto.randomUUID needs a secure context and the wall is plain HTTP. */
export function newItemId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ── views for the screen (slice 2) ───────────────────────────────────────────

export const LIST_TITLE = "Shopping";
const openItems = (items: ListItem[]): ListItem[] => sortItems(items).filter((i) => !i.done);

export interface ListPaneView { caption: string; names: string[]; more: number; sr: string; stale: boolean }

/** The glance pane: null drops it (nothing to get, or never loaded). Ticked items neither show nor count. */
export function listPaneView(items: ListItem[] | null, stale: boolean): ListPaneView | null {
  const open = items ? openItems(items) : [];
  if (open.length === 0) return null;
  const more = open.length > 4 ? open.length - 3 : 0;
  const names = open.slice(0, more ? 3 : open.length).map((i) => i.text);
  const caption = `${LIST_TITLE} \u00b7 ${open.length} to get`;
  const sr = `${LIST_TITLE}, ${open.length} to get: ${names.join(", ")}${more ? ` and ${more} more` : ""}`;
  return { caption, names, more, sr, stale };
}

/** The header button: count null = not loaded, shown without a number (never a fake 0). */
export function listButtonView(items: ListItem[] | null): { label: string; count: number | null; aria: string } {
  if (!items) return { label: LIST_TITLE, count: null, aria: "Shopping list, not loaded" };
  const n = openItems(items).length;
  return { label: LIST_TITLE, count: n, aria: n ? `Shopping list, ${n} to get` : "Shopping list, empty" };
}

export interface RowOrder { open: string[]; ticked: string[] }

/** Row order for an open sheet: a tick never moves a row; new ids go on top; `top` (a revived name) moves to the top. */
export function settleRows(prev: RowOrder | null, items: ListItem[], top?: string): RowOrder {
  const ids = new Set(items.map((i) => i.id));
  if (!prev) {
    const s = sortItems(items);
    return { open: s.filter((i) => !i.done).map((i) => i.id), ticked: s.filter((i) => i.done).map((i) => i.id) };
  }
  const known = new Set([...prev.open, ...prev.ticked]);
  const fresh = sortItems(items.filter((i) => !known.has(i.id)));
  const fresh1 = (done: boolean) => fresh.filter((i) => i.done === done).map((i) => i.id);
  const keep = (a: string[]) => a.filter((id) => ids.has(id) && id !== top);
  return { open: [...(top && ids.has(top) ? [top] : []), ...fresh1(false), ...keep(prev.open)], ticked: [...fresh1(true), ...keep(prev.ticked)] };
}

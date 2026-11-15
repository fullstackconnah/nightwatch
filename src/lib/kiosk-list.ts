// Shared by the kiosk list store (server) and, later, the sheet (client): pure, relative imports only.
export type ListId = "shopping";
export interface ListItem { id: string; listId: ListId; text: string; done: boolean; createdAt: number; doneAt: number | null; updatedAt: number }
export interface AddHistory { key: string; text: string; count: number; lastAt: number }
export interface ListFile { v: 1; items: ListItem[]; history: AddHistory[] }

export const MAX_LEN = 60;
export const MAX_ITEMS = 13;
export const DEFAULT_TZ = "Australia/Sydney";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isListId = (v: unknown): v is ListId => v === "shopping";

export const norm = (s: string): string =>
  // strip first, then NFC, so the result is idempotent; zero-width/format chars (incl. ZWJ in emoji) go too
  String(s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, "").normalize("NFC").replace(/\s+/g, " ").trim();
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
  if (items.length >= MAX_ITEMS) return { kind: "full" };
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
  return { v: 1, items: sortItems(items).slice(0, MAX_ITEMS), history };
}

/** v4-layout id from getRandomValues: crypto.randomUUID needs a secure context and the wall is plain HTTP. */
export function newItemId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

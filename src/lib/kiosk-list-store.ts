import fs from "node:fs/promises";
import path from "node:path";
import { readCapped } from "./read-capped.ts";
import {
  checkAdd, fold, isListId, norm, parseListFile, sortItems, suggestions, sweepBoundary, MAX_ITEMS, UUID_RE,
  type AddHistory, type ListFile, type ListItem,
} from "./kiosk-list.ts";

export interface ListReply { status: number; json: unknown }
export interface ListActionInput {
  body: string;
  contentLength: number;
  sessionCookie?: string;
  elevationCookie?: string;
  tz: string;
  now: number;
}

export const MAX_BODY_BYTES = 2048;
const MAX_BODY = MAX_BODY_BYTES;
const RESTORE_MS = 60_000;
const BUFFER_CAP = 2 * MAX_ITEMS;
const KEEP_CORRUPT = 3;
const HISTORY_CAP = 200;
const HISTORY_MS = 90 * 86400000;
const PER_MINUTE = 40;
const PER_DAY = 1500;
const ACTIONS = ["add", "done", "clear-ticked", "restore", "clear-all"];

interface State {
  file: ListFile | null; // memory copy; authoritative once loaded (one process)
  chain: Promise<unknown>;
  buffer: { item: ListItem; removedAt: number }[];
  writes: number[]; // limiter: start times of charged writes in the last 24 h
  seq: number;
}
const g = globalThis as unknown as { __kioskList?: State };
const st = (): State => (g.__kioskList ??= { file: null, chain: Promise.resolve(), buffer: [], writes: [], seq: 0 });

/** Test hook: forget the memory copy, restore buffer and limiter. */
export function resetKioskListState(): void { g.__kioskList = undefined; }

const dataDir = (): string => process.env.DATA_DIR || path.join(process.cwd(), "data");
const listPath = (): string => path.join(dataDir(), "kiosk-list.json");
const isMissing = (err: unknown): boolean => (err as NodeJS.ErrnoException | null)?.code === "ENOENT";

class StoreError extends Error {}
const fail = (status: number, error: string): ListReply => ({ status, json: { error } });
const ok = (json: unknown): ListReply => ({ status: 200, json });

async function load(): Promise<ListFile> {
  const s = st();
  if (s.file) return s.file;
  let raw: string;
  try {
    raw = await fs.readFile(listPath(), "utf8");
  } catch (err) {
    if (isMissing(err)) return (s.file = { v: 1, items: [], history: [] });
    throw new StoreError("read failed");
  }
  const parsed = parseListFile(raw);
  if (parsed) return (s.file = parsed);
  const kept = `${listPath()}.corrupt.${new Date().toISOString().replace(/\D/g, "")}`; // UTC digits: a later corrupt file never overwrites an earlier copy
  try { await fs.rename(listPath(), kept); } catch { throw new StoreError("corrupt file not kept"); } // never write over an unreadable file we could not keep
  try {
    const old = (await fs.readdir(dataDir())).filter((n) => /^kiosk-list\.json\.corrupt\.\d+$/.test(n)).sort().slice(0, -KEEP_CORRUPT);
    for (const n of old) await fs.rm(path.join(dataDir(), n), { recursive: true, force: true });
  } catch { /* pruning is best effort */ }
  console.warn("[kiosk-list] unparsable list file, kept as .corrupt.<time>, starting empty");
  return (s.file = { v: 1, items: [], history: [] });
}

async function write(next: ListFile): Promise<void> {
  const file = listPath();
  const tmp = `${file}.${process.pid}.${st().seq++}.tmp`;
  try {
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(next));
    await fs.rename(tmp, file);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw new StoreError("write failed");
  }
  st().file = next; // swapped only after the rename, so memory and file always agree
}

/** One operation at a time; a failed one never breaks the chain. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const s = st();
  const run = s.chain.then(fn);
  s.chain = run.catch(() => {});
  return run;
}

function sweep(f: ListFile, tz: string, now: number): ListFile {
  const boundary = sweepBoundary(tz, now);
  const items = f.items.filter((i) => !(i.done && (i.doneAt ?? 0) < boundary));
  return items.length === f.items.length ? f : { ...f, items };
}

function pruneBuffer(now: number): void {
  const s = st();
  s.buffer = s.buffer.filter((b) => now - b.removedAt <= RESTORE_MS).slice(-BUFFER_CAP);
}

function bump(history: AddHistory[], text: string, now: number): AddHistory[] {
  const key = fold(text);
  const hit = history.find((h) => h.key === key);
  const next = hit
    ? history.map((h) => (h === hit ? { ...h, text, count: h.count + 1, lastAt: now } : h))
    : [...history, { key, text, count: 1, lastAt: now }];
  return next.filter((h) => h.lastAt >= now - HISTORY_MS).sort((a, b) => b.lastAt - a.lastAt).slice(0, HISTORY_CAP);
}

/** Fixed budget, server-wide (no trustworthy client identity); a refused write is not recorded. */
function allow(now: number): boolean {
  const s = st();
  s.writes = s.writes.filter((t) => t > now - 86400000);
  if (s.writes.length >= PER_DAY || s.writes.filter((t) => t > now - 60_000).length >= PER_MINUTE) return false;
  s.writes.push(now);
  return true;
}

export async function handleListGet(input: { list: string | null; tz: string; now: number }): Promise<ListReply> {
  if (input.list !== null && !isListId(input.list)) return fail(400, "bad_list");
  try {
    return await locked(async () => {
      const f = await load();
      const swept = sweep(f, input.tz, input.now);
      if (swept !== f) await write(swept).catch(() => {}); // a failed sweep write is retried by the next call
      pruneBuffer(input.now);
      return ok({ listId: "shopping", items: sortItems(swept.items), suggestions: suggestions(swept.history, swept.items, input.now), serverTime: input.now });
    });
  } catch {
    return fail(503, "store");
  }
}

const idList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length >= 1 && v.length <= BUFFER_CAP && v.every((x) => typeof x === "string" && UUID_RE.test(x))
    ? (v as string[]).map((x) => x.toLowerCase())
    : null;

// Loaded lazily so a request with neither cookie never needs the JWT library.
async function elevated(session?: string, elevation?: string): Promise<boolean> {
  if (!session && !elevation) return false;
  const a = await import("./auth.ts");
  return (await a.verifySessionToken(session)) || (await a.verifyKioskElevationToken(elevation));
}

/** Reads a request body capped at MAX_BODY bytes whatever content-length says (chunked or bogus headers included). */
export async function readListBody(req: { headers: Headers; body: ReadableStream<Uint8Array> | null }): Promise<{ body: string; tooLarge: boolean }> {
  // cap + 4 so a multi-byte char cut at the cap still decodes to more than MAX_BODY bytes
  const text = await readCapped(req, MAX_BODY + 4);
  if (text === null || Buffer.byteLength(text, "utf8") > MAX_BODY) return { body: "", tooLarge: true };
  return { body: text, tooLarge: false };
}

export async function handleListAction(action: string, input: ListActionInput): Promise<ListReply> {
  const { now } = input;
  if (!ACTIONS.includes(action)) return fail(404, "unknown_action");
  if (input.contentLength > MAX_BODY || Buffer.byteLength(input.body, "utf8") > MAX_BODY) return fail(400, "too_large");
  let b: Record<string, unknown>;
  try {
    const j: unknown = JSON.parse(input.body);
    if (!j || typeof j !== "object" || Array.isArray(j)) return fail(400, "bad_json");
    b = j as Record<string, unknown>;
  } catch {
    return fail(400, "bad_json");
  }
  if (!isListId(b.listId)) return fail(400, "bad_list");

  let id = "";
  let text = "";
  let done = false;
  let restoreIds: string[] = [];
  if (action === "add" || action === "done") {
    if (typeof b.id !== "string" || !UUID_RE.test(b.id)) return fail(400, "bad_id");
    id = b.id.toLowerCase();
  }
  if (action === "add") {
    const c = checkAdd(typeof b.text === "string" ? b.text : "", []);
    if (c.kind === "blank" || c.kind === "long") return fail(400, c.kind);
    text = norm(b.text as string);
  }
  if (action === "done") {
    if (typeof b.done !== "boolean") return fail(400, "bad_done");
    done = b.done;
  }
  if (action === "restore") {
    const r = idList(b.ids);
    if (!r) return fail(400, "bad_ids");
    restoreIds = r;
  }
  if (action === "clear-all" && !(await elevated(input.sessionCookie, input.elevationCookie))) return fail(403, "elevation");
  if (!allow(now)) return fail(429, "rate");

  try {
    return await locked(async () => {
      const s = st();
      const loaded = await load();
      const f = sweep(loaded, input.tz, now);
      pruneBuffer(now);
      let next: ListFile = f;
      let reply: ListReply;
      let after = (): void => {};
      const removeAll = (gone: ListItem[]) => {
        next = { ...f, items: f.items.filter((i) => !gone.includes(i)) };
        after = () => { s.buffer = [...s.buffer, ...gone.map((item) => ({ item, removedAt: now }))].slice(-BUFFER_CAP); };
        return ok({ removed: gone });
      };

      if (action === "add") {
        const replay = f.items.find((i) => i.id === id);
        const c = checkAdd(text, f.items);
        if (replay) reply = ok({ result: "replay", item: replay });
        else if (c.kind === "dupe") reply = ok({ result: "exists", item: c.item });
        else if (c.kind === "full") reply = fail(409, "full");
        else {
          const history = bump(f.history, text, now);
          if (c.kind === "revive") {
            const item = { ...(c.item as ListItem), done: false, doneAt: null, createdAt: now, updatedAt: now };
            next = { ...f, items: [item, ...f.items.filter((i) => i !== c.item)], history };
            reply = ok({ result: "revived", item });
          } else {
            const item: ListItem = { id, listId: "shopping", text, done: false, createdAt: now, doneAt: null, updatedAt: now };
            next = { ...f, items: [item, ...f.items], history };
            reply = ok({ result: "added", item });
          }
        }
      } else if (action === "done") {
        const hit = f.items.find((i) => i.id === id);
        if (!hit) reply = fail(404, "missing");
        else if (hit.done === done) reply = ok({ item: hit });
        else {
          const item = { ...hit, done, doneAt: done ? now : null, updatedAt: now };
          next = { ...f, items: f.items.map((i) => (i === hit ? item : i)) };
          reply = ok({ item });
        }
      } else if (action === "clear-ticked") reply = removeAll(f.items.filter((i) => i.done));
      else if (action === "clear-all") reply = removeAll([...f.items]);
      else {
        const items = [...f.items];
        const restored: ListItem[] = [];
        const skipped: { id: string; reason: string }[] = [];
        for (const rid of restoreIds) {
          const held = s.buffer.find((x) => x.item.id === rid)?.item;
          const dupe = held && items.some((i) => !i.done && fold(i.text) === fold(held.text));
          const reason = items.some((i) => i.id === rid) ? "present" : !held ? "expired" : dupe ? "exists" : items.length >= MAX_ITEMS ? "full" : "";
          if (reason) skipped.push({ id: rid, reason });
          else { items.unshift(held as ListItem); restored.push(held as ListItem); }
        }
        if (restored.length) {
          next = { ...f, items: sortItems(items) };
          after = () => { s.buffer = s.buffer.filter((x) => !restored.includes(x.item)); };
        }
        reply = ok({ restored, skipped });
      }

      if (next !== loaded) await write(next);
      after();
      return reply;
    });
  } catch {
    return fail(503, "store");
  }
}

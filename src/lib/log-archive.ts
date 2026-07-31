import type { LogLevel, LogLine, LogStream } from "@/lib/log-types";

/**
 * Client-side log archive: one IndexedDB ring shared by every track on /logs.
 *
 * What this buys, stated precisely, because it is NOT "more lines". The live
 * buffer already holds LOG_BUFFER_CAP (2000) x MAX_TRACKS (6) = 12,000 lines in
 * memory — more than this archive's cap. What the archive adds is *survival*:
 * lines outlive a reload, a dropped SSE stream, an expired session, a container
 * being taken off the rail, and the dashboard's own redeploy. Reading history
 * for a container you are not currently watching is only possible here.
 *
 * Scale, from this host's own measurement (see log-types.ts): ~17 lines/minute
 * across all 26 containers. ARCHIVE_LINE_CAP therefore holds roughly ten hours
 * of whole-fleet output, and the byte ceiling is the one that actually bites
 * first on a chatty day — immich_postgres alone reaches 549 characters a line.
 */

const DB_NAME = "nightwatch-logs";
const DB_VERSION = 1;
const STORE = "lines";
const META = "meta";
const TOTALS_KEY = "totals";
/** `[container, ts]` — every per-container read and count goes through this. */
const IDX_CONTAINER_TS = "container_ts";
/** Global chronological order. Eviction is oldest-first across ALL containers. */
const IDX_TS = "ts";

/** Hard ceiling on archived lines, whichever ceiling trips first. */
export const ARCHIVE_LINE_CAP = 10_000;

/**
 * Byte ceiling, deliberately below what 10,000 worst-case lines would occupy
 * (10,000 x 549 chars x 2 bytes ~ 11 MB). A quiet fleet fills the line cap
 * first; a single verbose container fills this one first. Both are real, so
 * both are enforced.
 */
export const ARCHIVE_BYTE_BUDGET = 6 * 1024 * 1024;

/**
 * Evict down to this fraction of whichever ceiling tripped, rather than to the
 * ceiling itself. Without the headroom every single arriving line past the cap
 * would trigger its own delete, turning a quiet fleet into a permanent
 * one-in-one-out churn against disk. At 90% the archive evicts in occasional
 * batches of ~1000 instead of continuously.
 */
const EVICT_TO = 0.9;

/**
 * Fraction of the browser's reported storage quota past which we evict
 * regardless of our own ceilings. The third safety net, and the only one that
 * responds to pressure this module did not create (other origins, a full disk).
 */
const QUOTA_PRESSURE = 0.8;

/** How long arriving lines are held before one batched write. */
const FLUSH_MS = 1500;
/** ...unless this many pile up first, which a container restart burst will do. */
const FLUSH_AT = 250;

export interface ArchivedLine {
  /** Content-derived. See `archiveKey` for why this is not `LogLine.id`. */
  key: string;
  container: string;
  ts: number;
  stream: LogStream;
  level: LogLevel;
  text: string;
  /** Approximate stored size; the currency of ARCHIVE_BYTE_BUDGET. */
  bytes: number;
}

export interface ArchiveStats {
  count: number;
  bytes: number;
  oldestTs: number | null;
  newestTs: number | null;
}

export const EMPTY_STATS: ArchiveStats = { count: 0, bytes: 0, oldestTs: null, newestTs: null };

/** IndexedDB is absent in SSR and in a few locked-down browser modes. */
export function archiveAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/* ---------------------------------------------------------------------- */
/* Identity                                                               */
/* ---------------------------------------------------------------------- */

/** cyrb53 — 53-bit, fast, no dependency. */
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The archive's primary key, derived from a line's CONTENT.
 *
 * `LogLine.id` cannot be used and the reason is subtle enough to be worth
 * spelling out. It is `${container}:${source}${seq}` where `seq` is a counter
 * private to one demuxer instance, restarting at 0 every time a demuxer is
 * created (log-stream.ts). A fresh demuxer is created for every scrollback read
 * and for every follow-stream attach, which means:
 *
 *   - `nginx:s0` is the oldest line of *whatever the tail window contained at
 *     that moment*. An hour later the window has slid and `nginx:s0` names a
 *     completely different physical line.
 *   - `nginx:l0` is the first live line of *this* attach. Reconnect and the
 *     counter starts over.
 *
 * Keyed on `id`, a reload would therefore overwrite unrelated archived records
 * with newer, different lines — silent corruption that would look like the
 * archive "losing" history at random.
 *
 * Content identity has one accepted cost: a container emitting the byte-identical
 * line twice within the same millisecond on the same stream collapses to one
 * record. Those two are indistinguishable to a reader anyway, and at 17
 * lines/min the case is theoretical — whereas re-seeding 200 identical lines on
 * every single reload is certain, and deduplicating THAT is the whole point.
 */
export function archiveKey(line: Pick<LogLine, "container" | "ts" | "stream" | "text">): string {
  // The field separator is written as the six-character escape sequence, never
  // as a literal NUL byte: a raw NUL in a .ts file makes git classify the whole
  // source as binary, costing every future diff and blame on this file. It keeps
  // a message that happens to begin with "stdout" from colliding with a real one.
  return `${line.container}:${line.ts}:${cyrb53(`${line.stream}\u0000${line.text}`).toString(36)}`;
}

/**
 * Approximate stored size. Deliberately an over-estimate (UTF-16 code units
 * plus fixed per-record overhead) so the byte ceiling errs toward evicting
 * early rather than toward blowing the quota it exists to protect.
 */
function approxBytes(container: string, text: string): number {
  return text.length * 2 + container.length * 2 + 80;
}

function toRecord(line: LogLine): ArchivedLine {
  return {
    key: archiveKey(line),
    container: line.container,
    ts: line.ts,
    stream: line.stream,
    level: line.level,
    text: line.text,
    bytes: approxBytes(line.container, line.text),
  };
}

/**
 * Back to a renderable line. The id is namespaced `a:` so an archived line can
 * never collide with a live one as a React key — live ids restart from 0 each
 * session, so `nginx:l3` genuinely can name two different lines on screen at
 * once (one pulled from history, one that just arrived).
 */
export function toLogLine(rec: ArchivedLine): LogLine {
  return {
    id: `a:${rec.key}`,
    container: rec.container,
    ts: rec.ts,
    stream: rec.stream,
    level: rec.level,
    text: rec.text,
  };
}

/* ---------------------------------------------------------------------- */
/* Connection                                                             */
/* ---------------------------------------------------------------------- */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex(IDX_TS, "ts");
        store.createIndex(IDX_CONTAINER_TS, ["container", "ts"]);
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    open.onsuccess = () => {
      const db = open.result;
      // A second tab running a future DB_VERSION would otherwise block that
      // tab's upgrade forever. Close and let the caller reopen.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    open.onerror = () => reject(open.error ?? new Error("could not open the log archive"));
    // Private-mode Firefox and a few enterprise policies never fire either
    // handler; without this the archive would hang every caller forever.
    open.onblocked = () => reject(new Error("the log archive is blocked by another tab"));
  });
  return dbPromise;
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("archive request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("archive transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("archive transaction failed"));
  });
}

/* ---------------------------------------------------------------------- */
/* Write path                                                             */
/* ---------------------------------------------------------------------- */

let queue: LogLine[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
/** Notified after every successful flush so the UI's readout stays truthful. */
const listeners = new Set<() => void>();

export function onArchiveChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

/**
 * Hand lines to the archive. Returns immediately — never on the arrival path's
 * critical section. Batching matters more than it looks: a container restart
 * lands ~200 lines at once, and 200 single-record transactions is a very
 * different cost from one transaction of 200 records.
 */
export function enqueueLines(lines: LogLine[]): void {
  if (!archiveAvailable() || lines.length === 0) return;
  queue.push(...lines);
  if (queue.length >= FLUSH_AT) {
    void flushArchive();
    return;
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushArchive();
    }, FLUSH_MS);
  }
}

export function flushArchive(): Promise<void> {
  if (flushing) return flushing;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = queue;
  queue = [];
  if (batch.length === 0) return Promise.resolve();

  flushing = writeBatch(batch)
    .then(notify)
    .catch(() => {
      // A failed write must not take the console down with it — the live
      // buffer is untouched and still correct. Dropped rather than retried:
      // retrying into a quota error is how a stuck loop starts.
    })
    .finally(() => {
      flushing = null;
      // Drain whatever arrived while this write was in flight. Without it those
      // lines can sit in the queue indefinitely: `enqueueLines` takes an early
      // return once the queue is past FLUSH_AT, and `flushArchive` returns the
      // in-flight promise without draining or scheduling — so with the queue
      // only ever growing, every later call repeats that early return and the
      // only thing that would drain it is the page being hidden. A restart
      // burst landing on top of a write is enough to reach it.
      if (queue.length > 0 && flushTimer === null) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          void flushArchive();
        }, FLUSH_MS);
      }
    });
  return flushing;
}

async function writeBatch(batch: LogLine[]): Promise<void> {
  const db = await openDb();
  const pressured = await underQuotaPressure();

  // Deduplicate within the batch before touching IndexedDB: a re-seed after a
  // reconnect delivers the same lines the previous seed did.
  const records = new Map<string, ArchivedLine>();
  for (const line of batch) {
    const rec = toRecord(line);
    if (!records.has(rec.key)) records.set(rec.key, rec);
  }

  const tx = db.transaction([STORE, META], "readwrite");
  const store = tx.objectStore(STORE);
  const meta = tx.objectStore(META);

  // NOTE: every `await` below resolves from an IndexedDB request belonging to
  // THIS transaction, which is what keeps it alive. Awaiting anything else here
  // (a fetch, a timer, `underQuotaPressure()`) lets the transaction auto-commit
  // mid-flight and the rest of this function would throw. That is why the quota
  // probe runs above, before the transaction opens.
  const totals = ((await req(meta.get(TOTALS_KEY))) as { count: number; bytes: number } | undefined) ?? {
    count: 0,
    bytes: 0,
  };

  for (const rec of records.values()) {
    // getKey rather than get: we only need existence, and not deserializing
    // the record's text is the difference on a 549-character line.
    const existing = await req(store.getKey(rec.key));
    if (existing !== undefined) continue;
    store.put(rec);
    totals.count += 1;
    totals.bytes += rec.bytes;
  }

  const lineCeiling = pressured ? Math.floor(ARCHIVE_LINE_CAP * EVICT_TO) : ARCHIVE_LINE_CAP;
  const byteCeiling = pressured ? Math.floor(ARCHIVE_BYTE_BUDGET * EVICT_TO) : ARCHIVE_BYTE_BUDGET;

  if (totals.count > lineCeiling || totals.bytes > byteCeiling) {
    const targetCount = Math.floor(lineCeiling * EVICT_TO);
    const targetBytes = Math.floor(byteCeiling * EVICT_TO);
    await evictOldest(store, totals, targetCount, targetBytes);
  }

  meta.put(totals, TOTALS_KEY);
  await txDone(tx);
}

/**
 * Oldest-first across every container, walking the global `ts` index. Rolling
 * per-container would keep a container that logged once last week ahead of this
 * morning's real traffic, which is the opposite of what "recent" means to
 * someone reading a console.
 */
function evictOldest(
  store: IDBObjectStore,
  totals: { count: number; bytes: number },
  targetCount: number,
  targetBytes: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cursorReq = store.index(IDX_TS).openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return resolve();
      if (totals.count <= targetCount && totals.bytes <= targetBytes) return resolve();
      const rec = cursor.value as ArchivedLine;
      cursor.delete();
      totals.count -= 1;
      totals.bytes -= rec.bytes;
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("archive eviction failed"));
  });
}

async function underQuotaPressure(): Promise<boolean> {
  try {
    if (!navigator.storage?.estimate) return false;
    const { usage, quota } = await navigator.storage.estimate();
    if (!usage || !quota) return false;
    return usage / quota > QUOTA_PRESSURE;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------- */
/* Read path                                                              */
/* ---------------------------------------------------------------------- */

/** Newest `limit` archived lines for one container, returned oldest-first. */
export async function readLatest(container: string, limit: number): Promise<ArchivedLine[]> {
  return readRange(IDBKeyRange.bound([container, -Infinity], [container, Infinity]), limit);
}

/**
 * The `limit` archived lines immediately BEFORE `beforeTs`, oldest-first — what
 * "load earlier" needs. Exclusive upper bound so the line already on screen at
 * `beforeTs` is not handed back as a duplicate.
 */
export async function readBefore(
  container: string,
  beforeTs: number,
  limit: number,
): Promise<ArchivedLine[]> {
  return readRange(
    IDBKeyRange.bound([container, -Infinity], [container, beforeTs], false, true),
    limit,
  );
}

function readRange(range: IDBKeyRange, limit: number): Promise<ArchivedLine[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const out: ArchivedLine[] = [];
        const tx = db.transaction(STORE, "readonly");
        // "prev" then reverse: walking backwards from the newest end and
        // stopping at `limit` reads only the records asked for. Walking
        // forwards would have to visit every older record first.
        const cursorReq = tx.objectStore(STORE).index(IDX_CONTAINER_TS).openCursor(range, "prev");
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || out.length >= limit) {
            out.reverse();
            return resolve(out);
          }
          out.push(cursor.value as ArchivedLine);
          cursor.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error ?? new Error("archive read failed"));
      }),
  );
}

/** How many archived lines sit before `beforeTs` — the number "load earlier" quotes. */
export async function countBefore(container: string, beforeTs: number): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return req(
    tx
      .objectStore(STORE)
      .index(IDX_CONTAINER_TS)
      .count(IDBKeyRange.bound([container, -Infinity], [container, beforeTs], false, true)),
  );
}

/** Total archived lines for one container, live buffer irrelevant. */
export async function countFor(container: string): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return req(
    tx
      .objectStore(STORE)
      .index(IDX_CONTAINER_TS)
      .count(IDBKeyRange.bound([container, -Infinity], [container, Infinity])),
  );
}

export async function readStats(): Promise<ArchiveStats> {
  if (!archiveAvailable()) return EMPTY_STATS;
  const db = await openDb();
  const tx = db.transaction([STORE, META], "readonly");
  const meta = tx.objectStore(META);
  const index = tx.objectStore(STORE).index(IDX_TS);

  const totals = ((await req(meta.get(TOTALS_KEY))) as { count: number; bytes: number } | undefined) ?? {
    count: 0,
    bytes: 0,
  };
  // Two O(log n) cursor opens rather than a scan — the span is the honest way
  // to say "how much history is here", and it must not cost a full read.
  const oldest = await req(index.openCursor(null, "next"));
  const newest = await req(index.openCursor(null, "prev"));

  return {
    count: totals.count,
    bytes: totals.bytes,
    oldestTs: oldest ? (oldest.value as ArchivedLine).ts : null,
    newestTs: newest ? (newest.value as ArchivedLine).ts : null,
  };
}

/* ---------------------------------------------------------------------- */
/* Purge                                                                  */
/* ---------------------------------------------------------------------- */

/**
 * Delete everything. Reached from the console's own control and from signing
 * out — container logs on this box carry gluetun credentials, cloudflared
 * tunnel tokens and *arr API keys, and a deliberate sign-out should not leave
 * them sitting in IndexedDB on a machine the reader is walking away from.
 *
 * Session EXPIRY deliberately does not call this: that is the moment the
 * archive is most useful, and the reader has not chosen to leave.
 */
export async function clearArchive(): Promise<void> {
  if (!archiveAvailable()) return;
  queue = [];
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  // Settle any write already in flight before clearing. Its batch was taken out
  // of the queue before we emptied it, so without this wait its transaction can
  // commit AFTER the clear and leave behind exactly the lines the reader just
  // asked to be rid of — the one outcome this control must never produce.
  if (flushing) await flushing.catch(() => {});
  queue = [];
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const db = await openDb();
  const tx = db.transaction([STORE, META], "readwrite");
  tx.objectStore(STORE).clear();
  tx.objectStore(META).put({ count: 0, bytes: 0 }, TOTALS_KEY);
  await txDone(tx);
  notify();
}

// Offline queue for the wall's list: adds and ticks only (clears are retried by the user). Pure; the store that
// owns localStorage lives in components/kiosk/kiosk-list.tsx.
import { MAX_LEN, UUID_RE, isListId, sortItems, type ListItem } from "./kiosk-list.ts";

export type QueueOp =
  | { op: "add"; body: { listId: "shopping"; id: string; text: string } }
  | { op: "done"; body: { listId: "shopping"; id: string; done: boolean } };

export const QUEUE_KEY = "kiosk-list-queue";
export const QUEUE_CAP = 32;

const isOp = (v: unknown): v is QueueOp => {
  if (!v || typeof v !== "object") return false;
  const o = v as { op?: unknown; body?: Record<string, unknown> };
  const b = o.body;
  if (!b || typeof b !== "object" || !isListId(b.listId) || typeof b.id !== "string" || !UUID_RE.test(b.id)) return false;
  if (o.op === "add") return typeof b.text === "string" && b.text.length > 0 && b.text.length <= MAX_LEN;
  return o.op === "done" && typeof b.done === "boolean";
};

/** A corrupt blob is an empty queue; malformed entries are dropped one by one. */
export function parseQueue(raw: string | null): QueueOp[] {
  if (!raw) return [];
  try {
    const j: unknown = JSON.parse(raw);
    return Array.isArray(j) ? j.filter(isOp) : [];
  } catch {
    return [];
  }
}

/** Oldest first. A newer done for an id replaces the older one; overflow drops the oldest done, never an add. */
export function enqueue(q: QueueOp[], op: QueueOp): QueueOp[] {
  const next = [...(op.op === "done" ? q.filter((o) => !(o.op === "done" && o.body.id === op.body.id)) : q), op];
  if (next.length <= QUEUE_CAP) return next;
  const drop = next.findIndex((o) => o.op === "done");
  return drop === -1 ? next.slice(0, QUEUE_CAP) : next.filter((_, i) => i !== drop);
}

export type Outcome = "ok" | "drop" | "full" | "keep";

/** What one answer means for the op that was sent; null = no answer at all (network error). */
export function outcome(status: number | null): Outcome {
  if (status === null) return "keep";
  if (status >= 200 && status < 300) return "ok";
  if (status === 409) return "full";
  return status === 400 || status === 404 ? "drop" : "keep";
}

/** After the server answers an add with another item's id (exists/revived), queued ticks follow it. */
export const repoint = (q: QueueOp[], from: string, to: string): QueueOp[] =>
  q.map((o) => (o.op === "done" && o.body.id === from ? { ...o, body: { ...o.body, id: to } } : o));

/** The server's items with the unsent writes laid over them, so a pending row wins until it is acknowledged. */
export function applyQueue(items: ListItem[], q: QueueOp[], now: number): ListItem[] {
  let out = items;
  q.forEach((o, i) => {
    if (o.op === "add" && !out.some((x) => x.id === o.body.id)) {
      out = [...out, { id: o.body.id, listId: "shopping", text: o.body.text, done: false, createdAt: now + i, doneAt: null, updatedAt: now }];
    } else if (o.op === "done") {
      out = out.map((x) => (x.id === o.body.id ? { ...x, done: o.body.done, doneAt: o.body.done ? now : null } : x));
    }
  });
  return out === items ? items : sortItems(out);
}

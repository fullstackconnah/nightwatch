"use client";

/* THESIS: one shared shopping list for the wall (pick B "Count first"). The glance pane answers "is there shopping
   to do?" with the count in its caption; the header button is the way in; the sheet is a plain checklist plus a
   field, a few "often added" chips and a footer for clearing. Every write is optimistic and goes through the offline
   queue (kiosk-list-queue.ts), so a dropped network never loses an item. Only "Clear list" needs the PIN, and the
   server checks that itself. Pure rules live in kiosk-list.ts; this file is the store, the hook and the three views. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Check, ShoppingBasket, X } from "lucide-react";
import { fetcher } from "@/lib/client";
import { cn } from "@/lib/utils";
import { KIOSK_POP_MS, containerCollapse, containerExpand } from "@/lib/kiosk-motion";
import { useFreshness, type FreshnessStatus } from "@/lib/kiosk-client";
import { MAX_ITEMS, MAX_LEN, checkAdd, fold, listButtonView, newItemId, settleRows, type ListItem, type ListPaneView, type RowOrder } from "@/lib/kiosk-list";
import { QUEUE_KEY, applyQueue, enqueue, outcome, parseQueue, queuedIds, repoint, type QueueOp } from "@/lib/kiosk-list-queue";
import { KioskPortal } from "@/components/kiosk/kiosk-overlay-host";
import { SunSheetGrabber, slideSheetOut } from "@/components/kiosk/kiosk-sheet-grabber";
import { StaleTag } from "@/components/kiosk/kiosk-stale-tag";

const KEY = "/kiosk/api/list";
const SYNC_MS = 30_000;
const UNDO_MS = 8_000;
const UNDO_FAILED = "Couldn't put them back. Try again.";
const FULL_HINT = "List is full. Clear ticked items or clear the list to add more.";

interface ListResponse { listId: "shopping"; items: ListItem[]; suggestions: string[]; serverTime: number }

/* ── store: the unsent writes, shared by the button, the pane and the sheet ───────────────────────────────── */

interface StoreState { queue: QueueOp[]; failed: string[]; say: { n: number; text: string }; rejected: number }
const EMPTY: StoreState = { queue: [], failed: [], say: { n: 0, text: "" }, rejected: 0 };
let state: StoreState = EMPTY;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function setState(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  if (patch.queue) {
    try {
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(state.queue));
    } catch {
      // Private-mode storage failures just mean the queue does not survive a reload.
    }
  }
  subs.forEach((f) => f());
}

function subscribe(f: () => void) {
  if (subs.size === 0) {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(QUEUE_KEY);
    } catch {
      // unreadable storage reads as an empty queue
    }
    state = { ...state, queue: parseQueue(raw) };
    timer = setInterval(() => void flush(), SYNC_MS);
    queueMicrotask(() => void flush());
  }
  subs.add(f);
  return () => {
    subs.delete(f);
    if (subs.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function announce(text: string) {
  setState({ say: { n: state.say.n + 1, text } });
}

async function post(action: string, body: unknown): Promise<{ status: number | null; json: Record<string, unknown> | null }> {
  try {
    const res = await fetch(`${KEY}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  } catch {
    return { status: null, json: null };
  }
}

let flushing = false;
/** Sends the queue oldest first; stops at the first answer that means "try again later". */
export async function flush() {
  if (flushing) return;
  flushing = true;
  let sent = false;
  try {
    while (state.queue.length > 0) {
      const op = state.queue[0];
      const res = await post(op.op, op.body);
      const out = outcome(res.status);
      const id = op.body.id;
      if (out === "keep") {
        setState({ failed: queuedIds(state.queue) }); // every waiting row says "Not saved", not only the first
        return;
      }
      sent = true;
      let queue = state.queue.filter((o) => o !== op);
      const item = res.json?.item as ListItem | undefined;
      const served = item?.id;
      // Fold the answer into the cache before the op leaves the queue, so the row never blinks out while the refetch is in flight.
      if (out === "ok" && item) await globalMutate(KEY, (d: ListResponse | undefined) => (d ? { ...d, items: d.items.some((i) => i.id === item.id) ? d.items.map((i) => (i.id === item.id ? item : i)) : [item, ...d.items] } : d), { revalidate: false });
      if (out === "ok" && op.op === "add" && served && served !== id) queue = repoint(queue, id, served); // exists / revived: ticks follow the server's item
      const wasFailed = state.failed.includes(id);
      const waiting = queuedIds(queue);
      setState({ queue, failed: state.failed.filter((f) => waiting.includes(f)) });
      if (wasFailed && out === "ok" && op.op === "add") announce(`Saved ${op.body.text}.`);
      if (out === "full" && op.op === "add") {
        setState({ rejected: state.rejected + 1 }); // an open sheet shows the full hint; the row is already gone with the queue entry
        announce(FULL_HINT);
      }
    }
  } finally {
    flushing = false;
    if (sent) void globalMutate(KEY);
  }
}

export function queueOp(op: QueueOp) {
  setState({ queue: enqueue(state.queue, op) });
  void flush();
}

/* ── hook ──────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface KioskListData {
  status: FreshnessStatus;
  /** The server's items with unsent writes laid over them; null until the first answer. */
  items: ListItem[] | null;
  suggestions: string[];
  failed: string[];
  say: { n: number; text: string };
  rejected: number;
  refresh: () => Promise<boolean>;
}

export function useKioskList(): KioskListData {
  const swr = useSWR<ListResponse>(KEY, fetcher, { refreshInterval: SYNC_MS, keepPreviousData: true });
  const fr = useFreshness(swr);
  const snap = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  const items = useMemo(() => (fr.data ? applyQueue(fr.data.items, snap.queue, Date.now()) : null), [fr.data, snap.queue]);
  const { mutate } = swr;
  const refresh = useCallback(async () => {
    try {
      return (await mutate()) !== undefined;
    } catch {
      return false;
    }
  }, [mutate]);
  return { status: fr.status, items, suggestions: fr.data?.suggestions ?? [], failed: snap.failed, say: snap.say, rejected: snap.rejected, refresh };
}

/* ── the header button ─────────────────────────────────────────────────────────────────────────────────────── */

export function KioskListButton({ onClick }: { onClick: (rect: DOMRect) => void }) {
  const v = listButtonView(useKioskList().items);
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e.currentTarget.getBoundingClientRect());
      }}
      aria-label={v.aria}
      className="flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-line px-3 text-sm text-ink outline-none kiosk-press hover:border-line-bright hover:bg-panel-2 focus-visible:ring-1 focus-visible:ring-accent"
    >
      <ShoppingBasket size={14} aria-hidden />
      <span>{v.label}</span>
      {v.count !== null && <span className={cn("font-mono tabular-nums", v.count === 0 && "text-ink-faint")}>{v.count}</span>}
    </button>
  );
}

/* ── the glance pane (text only, no controls: a press promotes glance like any other pane) ──────────────── */

export function KioskListPane({ view }: { view: ListPaneView }) {
  return (
    <div data-lists-pane="" className="flex w-full max-w-xl flex-col gap-1 text-left">
      <span className="sr-only">
        {view.sr}
        {view.stale ? " Not updated recently." : ""}
      </span>
      <div aria-hidden className="flex h-6 items-center gap-2">
        <span className="microlabel">{view.caption}</span>
        {view.stale && <StaleTag />}
      </div>
      <div aria-hidden data-lists-body="" className="text-xl leading-snug text-ink">
        {view.names.map((n, i) => (
          <span key={i}>
            {i > 0 && <span className="text-ink-faint">{" · "}</span>}
            <span className="inline-block max-w-[45%] truncate align-bottom">{n}</span>
          </span>
        ))}
        {view.more > 0 && <span className="text-ink-dim">{` and ${view.more} more`}</span>}
      </div>
    </div>
  );
}

/* ── the sheet ─────────────────────────────────────────────────────────────────────────────────────────────── */

const BTN = "h-11 shrink-0 rounded-md border border-line px-3 text-xs text-ink-dim outline-none kiosk-press hover:border-line-bright hover:bg-panel-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40";
const ACCENT_BTN = "h-11 shrink-0 rounded-md border border-accent/30 bg-accent/10 px-4 text-sm text-accent outline-none kiosk-press hover:bg-accent/20 focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40";
const TICK_MOTION = "transition-[opacity,transform,color] duration-[var(--kiosk-fade-ms)] ease-[var(--kiosk-ease-out)] motion-reduce:transition-none";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type Footer =
  | { k: "idle" }
  | { k: "confirm" }
  | { k: "undo"; text: string; ids: string[] }
  | { k: "error"; text: string };
const IDLE: Footer = { k: "idle" };

function ListRow({ item, failed, onToggle, onRetry }: { item: ListItem; failed: boolean; onToggle: () => void; onRetry: () => void }) {
  const descId = `kiosk-list-unsaved-${item.id}`;
  return (
    <div className="flex h-11 min-w-0 items-center">
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        aria-describedby={failed ? descId : undefined}
        onClick={onToggle}
        className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-1 text-left text-sm outline-none kiosk-press hover:bg-panel-2 focus-visible:ring-1 focus-visible:ring-accent"
      >
        <span aria-hidden className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border", item.done ? "border-ink-faint" : "border-line-bright")}>
          <Check size={14} className={cn(TICK_MOTION, item.done ? "scale-100 opacity-100" : "scale-[0.6] opacity-0")} />
        </span>
        <span className={cn("min-w-0 flex-1 truncate", TICK_MOTION, item.done ? "text-ink-faint line-through" : "text-ink")}>{item.text}</span>
      </button>
      {failed && (
        <>
          <span id={descId} className="shrink-0 px-2 text-xs text-warn">Not saved</span>
          <button type="button" onClick={onRetry} aria-label={`Retry saving ${item.text}`} className={BTN}>Retry</button>
        </>
      )}
    </div>
  );
}

export function KioskListSheet({
  onClose,
  originRect,
  expiresAt,
  onNeedPin,
}: {
  onClose: () => void;
  originRect?: DOMRect | null;
  /** The elevation window's end (page.tsx), null when not elevated. A new value also clears a lapsed-PIN notice. */
  expiresAt: number | null;
  onNeedPin: (rect: DOMRect) => void;
}) {
  const list = useKioskList();
  const { items, status, failed, refresh } = list;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const closingRef = useRef(false);
  const closeFiredRef = useRef(false);
  const [keyed, setKeyed] = useState(false); // no focus ring on open (an iPad): the first key press brings it back
  const [text, setText] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [footer, setFooter] = useState<Footer>(IDLE);
  const [needPin, setNeedPin] = useState(false);
  const seenRejected = useRef(list.rejected);
  useEffect(() => {
    if (list.rejected !== seenRejected.current) setHint(FULL_HINT); // a queued add met 409 full on replay
    seenRejected.current = list.rejected;
  }, [list.rejected]);

  // Focus the close button on open (never the field: that raises the keyboard unasked); give it back on unmount.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    void refresh(); // sync on open
    return () => previouslyFocused?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const node = dialogRef.current;
    const anim = originRect && node ? containerExpand(node, originRect) : null;
    return () => anim?.cancel();
    // Mount-only: originRect is fixed for the life of one open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function requestClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    const node = dialogRef.current;
    if (node && slideSheetOut(node, onClose)) return;
    if (originRect && node) {
      const fire = () => {
        if (closeFiredRef.current) return;
        closeFiredRef.current = true;
        onClose();
      };
      const anim = containerCollapse(node, originRect);
      if (anim) {
        anim.finished.catch(() => {}).finally(fire);
        window.setTimeout(fire, KIOSK_POP_MS + 80); // the sheet must never become undismissable
        return;
      }
    }
    onClose();
  }

  function onDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    setKeyed(true);
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key !== "Tab") return;
    const container = dialogRef.current;
    if (!container) return;
    const focusable = Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (focusable.length === 0) {
      e.preventDefault();
      container.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  // A fresh elevation (or a new window) clears a "this needs the PIN" ruling from a 403.
  useEffect(() => setNeedPin(false), [expiresAt]);

  // The undo line goes at 8 s.
  useEffect(() => {
    if (footer.k !== "undo") return;
    const t = window.setTimeout(() => setFooter(IDLE), UNDO_MS);
    return () => window.clearTimeout(t);
  }, [footer]);

  // Row order: a tick never moves a row; new ids go on top.
  const orderRef = useRef<RowOrder | null>(null);
  const topRef = useRef<string | undefined>(undefined);
  if (items) {
    orderRef.current = settleRows(orderRef.current, items, topRef.current);
    topRef.current = undefined;
  }
  const order = orderRef.current;
  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const total = items?.length ?? 0;
  const tickedCount = (items ?? []).filter((i) => i.done).length;
  const full = total >= MAX_ITEMS;
  const ready = status === "ready" || status === "ready-stale";

  const touch = () => setFooter((f) => (f.k === "undo" || f.k === "error" ? IDLE : f));

  function add(raw: string): boolean {
    if (!items) return false;
    const c = checkAdd(raw, items);
    touch();
    if (c.kind === "blank") return false;
    if (c.kind === "long" || c.kind === "full") {
      setHint(c.kind === "long" ? `${MAX_LEN} characters at most.` : FULL_HINT);
      return false;
    }
    if (c.kind === "dupe" && c.item) {
      setHint(`${c.item.text} is already on the list.`);
      return true;
    }
    if (c.kind === "revive" && c.item) {
      const hit = items.find((i) => fold(i.text) === fold(c.item!.text));
      if (hit) topRef.current = hit.id;
      setHint(`${c.item.text} is back on the list.`);
      queueOp({ op: "add", body: { listId: "shopping", id: newItemId(), text: c.item.text } });
      return true;
    }
    if (c.kind === "add") {
      setHint(null);
      queueOp({ op: "add", body: { listId: "shopping", id: newItemId(), text: c.text } });
      announce(`Added ${c.text}.`);
      return true;
    }
    return false;
  }

  function submit(raw: string) {
    if (add(raw)) setText("");
    fieldRef.current?.focus(); // the keyboard stays up for the next item
  }

  function toggle(item: ListItem) {
    touch();
    setHint(null);
    queueOp({ op: "done", body: { listId: "shopping", id: item.id, done: !item.done } });
    announce(item.done ? `${item.text} back on the list.` : `Ticked ${item.text}.`);
  }

  async function clear(kind: "ticked" | "all") {
    if (!items) return;
    const gone = new Set(items.filter((i) => kind === "all" || i.done).map((i) => i.id));
    void globalMutate(KEY, (d: ListResponse | undefined) => (d ? { ...d, items: d.items.filter((i) => !gone.has(i.id)) } : d), { revalidate: false }); // optimistic
    setFooter(IDLE);
    const res = await post(kind === "all" ? "clear-all" : "clear-ticked", { listId: "shopping" });
    const removed = res.status === 200 ? ((res.json?.removed as ListItem[] | undefined) ?? []) : null;
    if (removed) {
      if (kind === "all") setState({ queue: [], failed: [] }); // waiting adds would bring the cleared items back
      const label = kind === "all" ? plural(removed.length, "item") : `${plural(removed.length, "ticked item")}`;
      const text = `Cleared ${label}.`;
      setFooter({ k: "undo", text, ids: removed.map((i) => i.id) });
      announce(text);
    } else if (kind === "all" && res.status === 403) {
      setNeedPin(true);
      setFooter({ k: "confirm" });
    } else {
      setFooter({ k: "error", text: kind === "all" ? "Couldn't clear the list. Try again." : "Couldn't clear. Try again." });
    }
    void refresh();
  }

  async function undo(ids: string[]) {
    setFooter(IDLE);
    const res = await post("restore", { listId: "shopping", ids });
    const back = (res.json?.restored as unknown[] | undefined)?.length ?? 0;
    if (res.status === 200 && back > 0) announce(`Put back ${plural(back, "item")}.`);
    else {
      setFooter({ k: "error", text: UNDO_FAILED });
      announce(UNDO_FAILED);
    }
    void refresh();
  }

  async function tryAgain() {
    if (!(await refresh())) setHint("Still no answer from the server.");
  }

  const elevated = expiresAt !== null && !needPin;
  const suggestions = list.suggestions.filter((s) => !(items ?? []).some((i) => !i.done && fold(i.text) === fold(s))).slice(0, 4);
  const disabled = !ready || full;
  const shownHint = hint ?? (text.length >= MAX_LEN ? `${MAX_LEN} characters at most.` : full ? FULL_HINT : "");
  const cols = total > 6 ? "grid-cols-2" : "grid-cols-1";
  const rowFor = (id: string) => {
    const it = byId.get(id);
    return it ? <ListRow key={id} item={it} failed={failed.includes(id)} onToggle={() => toggle(it)} onRetry={() => void flush()} /> : null;
  };

  return (
    <KioskPortal>
      <div
        data-sr-overlay="sheet"
        className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 px-4 py-6 backdrop-blur-sm"
        onClick={requestClose}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) e.preventDefault(); // same guard as the timers scrim
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="kiosk-list-title"
          tabIndex={-1}
          onKeyDown={onDialogKeyDown}
          data-sr-face="float"
          data-list-sheet=""
          className="panel relative flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-hidden p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <SunSheetGrabber panelRef={dialogRef} onDismiss={requestClose} />
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div className="flex items-center gap-2">
              <ShoppingBasket size={15} className="text-accent" aria-hidden />
              <h2 id="kiosk-list-title" data-sr-title className="text-sm font-semibold tracking-tight">Shopping</h2>
              {status === "ready-stale" && <StaleTag />}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className={cn("-mr-2.5 flex h-11 w-11 items-center justify-center rounded-md text-ink-dim outline-none hover:text-ink", keyed && "focus-visible:ring-1 focus-visible:ring-accent")}
            >
              <X size={16} />
            </button>
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(text);
            }}
          >
            <input
              ref={fieldRef}
              type="text"
              value={text}
              maxLength={MAX_LEN}
              disabled={disabled}
              onChange={(e) => {
                setText(e.target.value);
                setHint(null);
              }}
              aria-label="Add an item"
              placeholder="Add an item"
              className="h-11 min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent/50 focus:ring-1 focus:ring-accent/30 disabled:opacity-40"
            />
            <button type="submit" disabled={disabled || !text.trim()} className={ACCENT_BTN}>Add</button>
          </form>
          <p role="status" className="min-h-[22px] text-sm text-ink-dim">{shownHint}</p>

          {suggestions.length > 0 && (
            <div>
              <div className="microlabel mb-2">Often added</div>
              <div data-list-chips="" className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s} type="button" disabled={disabled} onClick={() => submit(s)} className="h-11 rounded-tile border border-line px-3 text-xs text-ink-dim outline-none kiosk-press hover:border-line-bright hover:bg-panel-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div data-sr-sheet-body className="min-h-0 flex-1 overflow-y-auto">
            {status === "loading" && <p className="text-sm text-ink-faint">Loading the list…</p>}
            {status === "unreachable-empty" && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-ink-dim">Couldn&apos;t load the shopping list.</p>
                <button type="button" onClick={() => void tryAgain()} className={BTN}>Try again</button>
              </div>
            )}
            {ready && order && total === 0 && (
              <div className="text-sm text-ink-dim">
                <p>Nothing on the list.</p>
                <p className="text-ink-faint">{suggestions.length > 0 ? "Type above, or tap something you often buy." : "Type above to add the first item."}</p>
              </div>
            )}
            {ready && order && total > 0 && (
              <>
                <div role="group" aria-label="To get" className={cn("grid gap-x-4 gap-y-1", cols)}>{order.open.map(rowFor)}</div>
                {order.ticked.length > 0 && (
                  <>
                    <div className="flex items-baseline gap-2 pb-1 pt-4">
                      <span className="microlabel">Ticked</span>
                      <span className="text-xs text-ink-faint">Clears at 4 am</span>
                    </div>
                    <div role="group" aria-label="Ticked" className={cn("grid gap-x-4 gap-y-1", cols)}>{order.ticked.map(rowFor)}</div>
                  </>
                )}
              </>
            )}
          </div>

          {ready && (total > 0 || footer.k !== "idle") && (
            <div className="flex items-center gap-2 border-t border-line pt-3" data-list-footer="">
              {footer.k === "undo" && (
                <>
                  <span className="min-w-0 flex-1 text-xs text-ink-dim">{footer.text}</span>
                  <button type="button" onClick={() => void undo(footer.ids)} className={BTN}>Undo</button>
                </>
              )}
              {footer.k === "confirm" && (
                <>
                  <span className="min-w-0 flex-1 text-xs text-ink">{elevated ? `Clear all ${plural(total, "item")}?` : `Clear all ${plural(total, "item")}? This needs the PIN.`}</span>
                  <button type="button" onClick={() => setFooter(IDLE)} className={BTN}>Cancel</button>
                  {elevated ? (
                    <button type="button" onClick={() => void clear("all")} className={ACCENT_BTN}>{`Clear ${plural(total, "item")}`}</button>
                  ) : (
                    <button type="button" onClick={(e) => onNeedPin(e.currentTarget.getBoundingClientRect())} className={ACCENT_BTN}>Enter PIN</button>
                  )}
                </>
              )}
              {(footer.k === "idle" || footer.k === "error") && (
                <>
                  <span className="min-w-0 flex-1 text-xs text-warn">{footer.k === "error" ? footer.text : ""}</span>
                  {total > 0 && tickedCount > 0 && <button type="button" onClick={() => void clear("ticked")} className={BTN}>{`Clear ${tickedCount} ticked`}</button>}
                  {total > 0 && <button type="button" onClick={() => setFooter({ k: "confirm" })} className={BTN}>Clear list</button>}
                </>
              )}
            </div>
          )}
          <div role="status" className="sr-only">{list.say.text}</div>
        </div>
      </div>
    </KioskPortal>
  );
}

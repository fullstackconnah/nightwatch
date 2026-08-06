"use client";

/* THESIS: qBittorrent downloads get the same button+tray shape as
   kiosk-alerts.tsx (fixed corner icon, badge, anchored non-modal popover) —
   modelled on that file's vocabulary, not extended from it, because the two
   surfaces share almost no markup: alerts is severity-coloured and carries a
   full-screen takeover, downloads is neutral and carries a progress ring and
   a toast instead. What downloads adds beyond that shape is its own: a
   size-weighted aggregate progress ring on the button (thermal-gauge.tsx's
   dasharray technique, swept the full 360° rather than a 270° arc), and a
   toast that fires once per NEWLY-started torrent, edge-detected the same
   way kiosk-doorbell.tsx's useDoorbellWatch tells a fresh ring from history:
   a ref Set seeded on the first successful poll, so a reload never
   re-announces a download that was already running.

   Ignoring zero-speed torrents is NOT this file's job — that filter runs
   server-side in getKioskDownloads (src/lib/widgets/builtins.ts) before the
   payload ever reaches this unauthenticated surface, so every item this
   file ever sees is already "actually downloading right now" by
   construction. */

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import useSWR from "swr";
import { Download } from "lucide-react";
import { fetcher } from "@/lib/client";
import { formatRate, formatUptime } from "@/lib/format";
import { Meter } from "@/components/charts";
import { cn } from "@/lib/utils";
import { KIOSK_EASE_OUT, KIOSK_FADE_MS, KIOSK_POP_MS, KIOSK_REDUCED_MS, prefersReducedMotion } from "@/lib/kiosk-motion";
import type { KioskDownloadItem, KioskDownloadsResult } from "@/lib/downloads-types";

const POLL_MS_ACTIVE = 10_000;
const POLL_MS_EMPTY = 30_000;
const TRAY_AUTO_CLOSE_MS = 20_000;
const TOAST_AUTO_DISMISS_MS = 8_000;
const TOAST_MAX_NAMES = 3;

/* ── data hook ───────────────────────────────────────────────────────────── */

/** Single shared poller — one SWR key for the button, tray and toast below,
 *  same "one poller, many consumers" idiom as kiosk-doorbell.tsx's
 *  useDoorbellSnapshot. Faster (10s) while something is actively moving,
 *  backed off (30s) once the tray has nothing to show — a wall tablet
 *  gains nothing from polling a quiet qBittorrent every 10s. */
export function useKioskDownloads() {
  return useSWR<KioskDownloadsResult>("/kiosk/api/downloads", fetcher, {
    refreshInterval: (latest) => (latest?.status === "ok" && latest.items.length > 0 ? POLL_MS_ACTIVE : POLL_MS_EMPTY),
    keepPreviousData: true,
  });
}

/** Σ progress·size / Σ size — the one honest way to collapse several
 *  in-flight torrents of very different sizes into a single ring value; a
 *  plain average of percentages would let a nearly-finished 200MB episode
 *  and a 5% 40GB box set claim the same "halfway" reading. */
function aggregateProgress(items: KioskDownloadItem[]): number {
  const totalSize = items.reduce((a, i) => a + i.size, 0);
  if (totalSize <= 0) return 0;
  const done = items.reduce((a, i) => a + i.progress * i.size, 0);
  return done / totalSize;
}

/* ── new-download edge detection (toast) ────────────────────────────────── */

interface DownloadToastState {
  /** Bumped per detection so each toast mount is a fresh WAAPI/timer
   *  instance — see the composition's `key={toast.key}` below. */
  key: number;
  /** A SNAPSHOT of the items that were new at detection time, not a live
   *  reference into the current poll — this is what lets the toast outlive
   *  its item (see the file-level composition's own note). */
  items: KioskDownloadItem[];
}

/** Edge-detects hashes that are newly present versus the last poll's set.
 *  Seeded (not started empty) on the FIRST successful poll, exactly like
 *  useDoorbellWatch's seenRef — a page load must adopt whatever's already
 *  downloading as history, never announce it as news. Skips entirely on a
 *  non-"ok" poll (unconfigured/unreachable) rather than touching the seen
 *  set, so a transient qBittorrent blip can't make everything look "new"
 *  again the moment it recovers. */
function useNewDownloadToast(result: KioskDownloadsResult | undefined): {
  toast: DownloadToastState | null;
  dismiss: () => void;
} {
  const seenRef = useRef<Set<string> | null>(null); // null = not yet seeded
  const [toast, setToast] = useState<DownloadToastState | null>(null);
  const toastKeyRef = useRef(0);

  useEffect(() => {
    if (!result || result.status !== "ok") return;
    const currentHashes = new Set(result.items.map((i) => i.hash));

    if (seenRef.current === null) {
      seenRef.current = currentHashes;
      return;
    }

    const seen = seenRef.current;
    const fresh = result.items.filter((i) => !seen.has(i.hash));
    // Replace, not merge: a hash that finishes and later reappears (a
    // re-added torrent) should read as new again, not stay permanently
    // "already seen" from an ever-growing set.
    seenRef.current = currentHashes;

    if (fresh.length === 0) return;
    toastKeyRef.current += 1;
    setToast({ key: toastKeyRef.current, items: fresh });
  }, [result]);

  const dismiss = useCallback(() => setToast(null), []);
  return { toast, dismiss };
}

/* ── button ──────────────────────────────────────────────────────────────── */

const RING_SIZE = 40;
const RING_STROKE = 2;

/** Full 360° progress ring — thermal-gauge.tsx's stroke-dasharray/-dashoffset
 *  arc technique, swept the whole way around instead of a 270° arc, rotated
 *  -90° so progress starts at 12 o'clock (SVG's y-axis points down, so an
 *  un-rotated 0° start sits at 3 o'clock — the same -rotate-90 trick
 *  charts.tsx's Gauge already uses for its own full-circle ring). */
function DownloadRing({ progress }: { progress: number }) {
  const r = RING_SIZE / 2 - RING_STROKE;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90" aria-hidden>
      <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={RING_STROKE} />
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={r}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - p * c}
        className="transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
      />
    </svg>
  );
}

interface KioskDownloadsButtonProps {
  items: KioskDownloadItem[];
  trayOpen: boolean;
  onPress: () => void;
}

export const KioskDownloadsButton = forwardRef<HTMLButtonElement, KioskDownloadsButtonProps>(
  function KioskDownloadsButton({ items, trayOpen, onPress }, forwardedRef) {
    const aggregate = useMemo(() => aggregateProgress(items), [items]);
    const count = items.length;
    const hasItems = count > 0;

    const innerRef = useRef<HTMLButtonElement>(null);
    const setRefs = useCallback(
      (node: HTMLButtonElement | null) => {
        innerRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    // Same mount/unmount fade as KioskAlertButton — rendered only while
    // hasItems, but held a beat longer so the last download finishing gets a
    // fade-out instead of popping out of existence mid-glance.
    const [mounted, setMounted] = useState(hasItems);
    const [entered, setEntered] = useState(false);

    useEffect(() => {
      if (hasItems) {
        setMounted(true);
        return;
      }
      setEntered(false);
      const t = setTimeout(() => setMounted(false), prefersReducedMotion() ? KIOSK_REDUCED_MS : KIOSK_FADE_MS);
      return () => clearTimeout(t);
    }, [hasItems]);

    useEffect(() => {
      if (!mounted) return;
      const node = innerRef.current;
      if (node) void node.getBoundingClientRect(); // forced reflow: commit opacity-0 before flipping entered
      setEntered(true);
    }, [mounted]);

    if (!mounted) return null;

    return (
      <button
        ref={setRefs}
        type="button"
        // Taps must not reach the surface's root promoter (glance→full) —
        // copied from kiosk-glance.tsx's corner controls, not from
        // kiosk-alerts.tsx (whose own button doesn't stop propagation).
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onPress();
        }}
        aria-expanded={trayOpen}
        aria-label={
          count > 0
            ? `${count} download${count === 1 ? "" : "s"} in progress, ${Math.round(aggregate * 100)}% average`
            : "Downloads"
        }
        style={{
          top: "calc(1rem + env(safe-area-inset-top))",
          // Sits LEFT of kiosk-alerts.tsx's button (right: 1.25rem, a
          // content-driven width around its own icon+badge). This component
          // can't measure that sibling directly, so the offset below is a
          // deliberately generous estimate — 4.75rem of clearance plus a
          // 0.75rem gap — sized for its worst realistic case (a
          // single-digit badge; kiosk-alerts.tsx's own file thesis notes
          // `entries` is length 0 or 1 today).
          right: "calc(1.25rem + 4.75rem + 0.75rem + env(safe-area-inset-right))",
          transitionDuration: `${KIOSK_FADE_MS}ms`,
          transitionTimingFunction: KIOSK_EASE_OUT,
        }}
        className={cn(
          "fixed z-(--z-toast) flex min-h-14 min-w-14 items-center justify-center gap-1.5 rounded-tile border border-line px-3 py-2 text-ink-dim outline-none kiosk-press transition-opacity motion-reduce:transition-none hover:border-line-bright hover:bg-panel-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent",
          entered ? "opacity-100" : "opacity-0 motion-reduce:opacity-100",
        )}
      >
        <span className="relative grid shrink-0 place-items-center" style={{ width: RING_SIZE, height: RING_SIZE }}>
          <DownloadRing progress={aggregate} />
          <Download size={16} className="absolute" aria-hidden />
        </span>
        {count > 1 && <span className="font-mono text-lg font-bold tabular-nums">{count}</span>}
      </button>
    );
  },
);

/* ── tray ────────────────────────────────────────────────────────────────── */

interface KioskDownloadsTrayProps {
  items: KioskDownloadItem[];
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
}

function DownloadRow({ item }: { item: KioskDownloadItem }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md px-2 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.name}</span>
        <span className="shrink-0 font-mono text-xs text-ink-dim tabular-nums">{Math.round(item.progress * 100)}%</span>
      </div>
      <Meter percent={item.progress * 100} label={`${item.name} download progress`} />
      <div className="flex items-center gap-3 font-mono text-2xs text-ink-faint">
        <span>{formatRate(item.dlspeed)}</span>
        {item.eta !== null && <span>eta {formatUptime(item.eta)}</span>}
      </div>
    </div>
  );
}

export function KioskDownloadsTray({ items, open, onClose, anchorRef }: KioskDownloadsTrayProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const firstRowRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasOpenRef = useRef(false);

  const resetAutoClose = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(onClose, TRAY_AUTO_CLOSE_MS);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    resetAutoClose();
    firstRowRef.current?.focus();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [open, resetAutoClose]);

  // Downloads has no resolved-history section to keep reading (unlike
  // kiosk-alerts.tsx's tray) — an open tray with zero items really is
  // nothing left to show, so it closes itself rather than sitting empty
  // until its own 20s auto-close.
  useEffect(() => {
    if (open && items.length === 0) onClose();
  }, [open, items.length, onClose]);

  useEffect(() => {
    if (wasOpenRef.current && !open) anchorRef.current?.focus();
    wasOpenRef.current = open;
  }, [open, anchorRef]);

  // Explicit tap-outside close: unlike kiosk-alerts.tsx's tray (which only
  // closes on Escape or its own 20s timeout), this one is specced to close
  // immediately on an outside tap. A document-level listener rather than a
  // blur/focus trick, since a kiosk's fixed overlays sit outside any single
  // focus-trap boundary. Excludes the anchor button itself defensively —
  // in practice its own onPointerDown already stops propagation before this
  // ever fires for a press on the button.
  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (nodeRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open, anchorRef, onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const node = nodeRef.current;
    if (!node || prefersReducedMotion()) return;
    const anim = node.animate(
      [
        { opacity: 0, transform: "translateY(-6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: KIOSK_POP_MS, easing: KIOSK_EASE_OUT },
    );
    return () => anim.cancel();
  }, [open]);

  if (!open || items.length === 0) return null;

  return (
    <div
      ref={nodeRef}
      role="dialog"
      aria-modal="false"
      aria-label="Downloads"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        resetAutoClose();
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDownCapture={resetAutoClose}
      style={{
        top: "calc(1rem + 3.5rem + 0.75rem + env(safe-area-inset-top))",
        right: "calc(1.25rem + 4.75rem + 0.75rem + env(safe-area-inset-right))",
      }}
      className="fixed z-(--z-toast) panel w-[min(20rem,calc(100vw-2rem))] max-h-[60vh] overflow-y-auto p-2 outline-none"
    >
      {items.map((item, i) => (
        <div
          key={item.hash}
          ref={i === 0 ? firstRowRef : undefined}
          tabIndex={-1}
          className="rounded-md outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <DownloadRow item={item} />
        </div>
      ))}
    </div>
  );
}

/* ── toast ───────────────────────────────────────────────────────────────── */

function toastNamesLabel(items: KioskDownloadItem[]): string {
  const names = items.slice(0, TOAST_MAX_NAMES).map((i) => i.name);
  const rest = items.length - names.length;
  return rest > 0 ? `${names.join(", ")} +${rest} more` : names.join(", ");
}

interface KioskDownloadsToastProps {
  toast: DownloadToastState;
  onDismiss: () => void;
}

/** Keyed on `toast.key` at the call site — a second, different detection
 *  arriving right after the first dismisses gets its own fresh mount (its
 *  own entrance animation and its own TOAST_AUTO_DISMISS_MS clock), same
 *  reasoning as KioskAlertTakeover's `key={activeTakeover.id}`. */
export function KioskDownloadsToast({ toast, onDismiss }: KioskDownloadsToastProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dismissedRef = useRef(false);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    const node = rootRef.current;
    if (node && !prefersReducedMotion()) {
      const anim = node.animate(
        [
          { opacity: 1, transform: "translate(-50%, 0)" },
          { opacity: 0, transform: "translate(-50%, -6px)" },
        ],
        { duration: KIOSK_FADE_MS, easing: KIOSK_EASE_OUT, fill: "forwards" },
      );
      anim.finished.then(onDismiss, onDismiss);
      return;
    }
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    const t = setTimeout(dismiss, TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [dismiss]);

  // Pop-in entrance: fade + slight rise, run in a layout effect so the first
  // paint already reflects the start keyframe instead of flashing the fully-
  // opaque resting state for one frame (same idiom as KioskAlertTakeover).
  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node || prefersReducedMotion()) return;
    const anim = node.animate(
      [
        { opacity: 0, transform: "translate(-50%, -6px)" },
        { opacity: 1, transform: "translate(-50%, 0)" },
      ],
      { duration: KIOSK_POP_MS, easing: KIOSK_EASE_OUT },
    );
    return () => anim.cancel();
  }, []);

  const aggregate = useMemo(() => aggregateProgress(toast.items), [toast.items]);
  const label = toastNamesLabel(toast.items);

  return (
    <div
      ref={rootRef}
      role="status"
      aria-live="polite"
      // Informational, not urgent (per spec) — "polite" so it never
      // interrupts anything already being announced, unlike
      // KioskAlertTakeover's "assertive".
      onPointerDown={(e) => {
        e.stopPropagation();
        dismiss();
      }}
      onClick={(e) => e.stopPropagation()}
      style={{
        top: "calc(1rem + env(safe-area-inset-top))",
        left: "50%",
        transform: "translate(-50%, 0)",
      }}
      className="fixed z-(--z-toast) panel flex w-[min(22rem,calc(100vw-2rem))] cursor-pointer flex-col gap-1.5 px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <Download size={15} className="shrink-0 text-accent" aria-hidden />
        <span className="microlabel">Download started</span>
      </div>
      <p className="truncate text-sm text-ink">{label}</p>
      <Meter percent={aggregate * 100} label={`${label} download progress`} />
    </div>
  );
}

/* ── composition ─────────────────────────────────────────────────────────── */

/** Renders the button, its tray and any pending toast. Returns effectively
 *  nothing while unconfigured/unreachable/empty — the button and tray both
 *  self-guard on `items.length`, and the toast is the one deliberate
 *  exception: it holds its own snapshot (see DownloadToastState) rather than
 *  a live reference, so a torrent finishing (and dropping out of `items`)
 *  mid-toast doesn't cut the announcement short. */
export function KioskDownloads() {
  const { data } = useKioskDownloads();
  const items = data?.status === "ok" ? data.items : [];
  const { toast, dismiss: dismissToast } = useNewDownloadToast(data);
  const [trayOpen, setTrayOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (items.length === 0) setTrayOpen(false);
  }, [items.length]);

  return (
    <>
      <KioskDownloadsButton ref={buttonRef} items={items} trayOpen={trayOpen} onPress={() => setTrayOpen((o) => !o)} />
      <KioskDownloadsTray items={items} open={trayOpen} onClose={() => setTrayOpen(false)} anchorRef={buttonRef} />
      {toast && <KioskDownloadsToast key={toast.key} toast={toast} onDismiss={dismissToast} />}
    </>
  );
}

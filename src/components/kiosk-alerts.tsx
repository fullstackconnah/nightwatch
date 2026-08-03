"use client";

/* THESIS: alerts move off the page (redesign-06's change #1) — no standing
   card competing with the clock for the kiosk's best real estate. Composed
   fresh in the same hairline/mono/microlabel vocabulary as
   kiosk-attention.tsx (the card this supersedes) rather than importing a
   generic toast/modal component, because the three surfaces here (a
   corner button, a non-modal tray, a full-screen takeover) share almost no
   markup with each other or with anything else in the app — a shared base
   component would just be indirection. Source stays /kiosk/api/attention
   (30s poll, one condition at a time, honesty rules in src/lib/attention.ts:
   an unreachable probe layer resolves to "quiet", never a fabricated
   alert). That single-condition shape is why `entries` below is a list of
   at most one today — built as a list (not a single nullable value) so the
   tray/badge/count plumbing doesn't have to change if the route ever grows
   a second concurrent condition. */

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import useSWR from "swr";
import { AlertTriangle } from "lucide-react";
import { fetcher } from "@/lib/client";
import type { AttentionResult, AttentionSeverity } from "@/lib/attention";
import { formatUptime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  KIOSK_EASE_OUT,
  KIOSK_FADE_MS,
  KIOSK_POP_MS,
  KIOSK_REDUCED_MS,
  flipOutTo,
  prefersReducedMotion,
} from "@/lib/kiosk-motion";

const POLL_MS = 30_000;
const TAKEOVER_MS = 8_000;
const TRAY_AUTO_CLOSE_MS = 20_000;

/* ── data hook ───────────────────────────────────────────────────────────── */

export interface KioskAlertEntry {
  id: string;
  severity: AttentionSeverity;
  headline: string;
  detail?: string;
  since?: string;
  /** False until its one-time takeover has been shown+dismissed (or was
   *  seeded as already-active on the first poll — see useKioskAlerts). */
  seen: boolean;
}

/** A retired KioskAlertEntry: same reported facts (severity/headline/detail/
 *  since), verbatim — plus WHEN it stopped being reported. Never carries an
 *  inferred cause or outcome ("fixed", "resolved automatically" etc.) — the
 *  probe only ever told us the condition stopped matching, not why, so the
 *  row must not claim more than that (same honesty rule attention.ts's own
 *  probes are held to). */
export interface KioskResolvedAlertEntry {
  id: string;
  severity: AttentionSeverity;
  headline: string;
  detail?: string;
  since?: string;
  /** Wall-clock ms when this id was first missing from a poll response. */
  clearedAt: number;
}

const RESOLVED_HISTORY_LIMIT = 5;

export interface UseKioskAlertsResult {
  /** Currently active alerts — length 0 or 1 today, see the file thesis. */
  entries: KioskAlertEntry[];
  /** Most-recent-first, capped at RESOLVED_HISTORY_LIMIT, session-only (this
   *  is component state — a reload starts empty, same as every other piece
   *  of device state on this surface). */
  resolved: KioskResolvedAlertEntry[];
  /** The one entry that still owes its takeover, or null. */
  activeTakeover: KioskAlertEntry | null;
  dismissTakeover: (id: string) => void;
  worstSeverity: AttentionSeverity | null;
}

/** Stable across polls as long as the condition hasn't changed — headline +
 *  severity + since, exactly as the contract specifies, so a routine 30s
 *  re-poll of the SAME condition never reads as a new alert. */
function alertId(a: Extract<AttentionResult, { status: "attention" }>): string {
  return `${a.severity}|${a.headline}|${a.since ?? ""}`;
}

function alertSinceLabel(since: string | undefined): string | null {
  if (!since) return null;
  const ms = Date.parse(since);
  if (isNaN(ms)) return null;
  return formatUptime(Math.max(0, (Date.now() - ms) / 1000));
}

function toResolved(active: KioskAlertEntry[], clearedAt: number): KioskResolvedAlertEntry[] {
  return active.map((e) => ({
    id: e.id,
    severity: e.severity,
    headline: e.headline,
    detail: e.detail,
    since: e.since,
    clearedAt,
  }));
}

interface AlertsState {
  active: KioskAlertEntry[];
  resolved: KioskResolvedAlertEntry[];
  /** True once any poll has resolved (quiet OR attention). The FIRST resolved
   *  poll seeds whatever it finds as already-seen, so a page reload never
   *  fires a takeover for a condition that was already standing.
   *
   *  This MUST live in state, not a ref written from the effect body: `setState`
   *  updater functions are lazy — React invokes them during its own render
   *  pass, not synchronously at the call site — so a ref write placed right
   *  after the `setState(...)` call runs BEFORE the updater actually executes,
   *  not after. That silently flipped `seen` to false on every first poll
   *  (confirmed on the real test-stack build, not a StrictMode artifact) and
   *  fired the takeover for an alert that was already standing on load, every
   *  load. Keeping `seeded` in the same object the updater already reads and
   *  returns makes the decision and its consequence atomic — there is no
   *  window where one has updated and the other hasn't. */
  seeded: boolean;
}

const EMPTY_STATE: AlertsState = { active: [], resolved: [], seeded: false };

export function useKioskAlerts(): UseKioskAlertsResult {
  const { data } = useSWR<AttentionResult>("/kiosk/api/attention", fetcher, {
    refreshInterval: POLL_MS,
    keepPreviousData: true,
  });

  // Active, resolved and seeded live in ONE state object, updated by ONE pure
  // setState call per poll — not two+ separate setState calls, or a setState
  // paired with a ref write, where one leaks state the other depends on. See
  // the `seeded` field's own doc comment for the bug this replaced.
  const [state, setState] = useState<AlertsState>(EMPTY_STATE);

  useEffect(() => {
    if (!data) return; // still loading — no opinion yet
    const now = Date.now();

    setState((prev) => {
      if (data.status === "quiet") {
        // Both directions matter: an already-seeded quiet poll with nothing
        // active is a true no-op (skip re-render), but an UNSEEDED quiet poll
        // must still flip `seeded` even though `active` stays empty —
        // otherwise the first real alert to arrive after a quiet start would
        // read `!prev.seeded` as true and wrongly seed ITSELF as already-seen,
        // silently swallowing its takeover.
        if (prev.active.length === 0 && prev.seeded) return prev;
        const resolved =
          prev.active.length > 0
            ? [...toResolved(prev.active, now), ...prev.resolved].slice(0, RESOLVED_HISTORY_LIMIT)
            : prev.resolved;
        return { active: [], resolved, seeded: true };
      }
      const id = alertId(data);
      if (prev.active.some((e) => e.id === id)) return prev; // same condition as last poll
      // Anything active under a DIFFERENT id has stopped being reported (the
      // probe moved on, in priority order, to a different condition) — retire it.
      const resolved =
        prev.active.length > 0
          ? [...toResolved(prev.active, now), ...prev.resolved].slice(0, RESOLVED_HISTORY_LIMIT)
          : prev.resolved;
      // Not yet seeded (this is the first poll this hook has ever resolved,
      // e.g. a fresh load or reload with a condition already standing) →
      // seed it as seen, no takeover. Already seeded → this id is genuinely
      // new → takeover fires.
      const seen = !prev.seeded;
      const active: KioskAlertEntry[] = [
        { id, severity: data.severity, headline: data.headline, detail: data.detail, since: data.since, seen },
      ];
      return { active, resolved, seeded: true };
    });
  }, [data]);

  const dismissTakeover = useCallback((id: string) => {
    setState((prev) => ({ ...prev, active: prev.active.map((e) => (e.id === id ? { ...e, seen: true } : e)) }));
  }, []);

  const activeTakeover = state.active.find((e) => !e.seen) ?? null;
  const worstSeverity: AttentionSeverity | null = state.active.some((e) => e.severity === "bad")
    ? "bad"
    : state.active.length > 0
      ? "warn"
      : null;

  return { entries: state.active, resolved: state.resolved, activeTakeover, dismissTakeover, worstSeverity };
}

/* ── button ──────────────────────────────────────────────────────────────── */

interface KioskAlertButtonProps {
  entries: KioskAlertEntry[];
  worstSeverity: AttentionSeverity | null;
  trayOpen: boolean;
  onPress: () => void;
}

export const KioskAlertButton = forwardRef<HTMLButtonElement, KioskAlertButtonProps>(function KioskAlertButton(
  { entries, worstSeverity, trayOpen, onPress },
  forwardedRef,
) {
  // The forwarded ref is what KioskAlerts uses as the FLIP target — this
  // component ALSO needs the live node itself, imperatively, for the WAAPI
  // pulse below. Both point at the same element; a plain merge-on-set
  // callback ref is simpler here than pulling in a ref-merging utility for
  // one caller.
  const innerRef = useRef<HTMLButtonElement>(null);
  const setRefs = useCallback(
    (node: HTMLButtonElement | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  // Deliberately `entries` (active) only, never `resolved`: the button — and
  // therefore the tray behind it — is reachable exclusively while something
  // is actually wrong. History with zero active alerts still renders no
  // button; don't "fix" this into `entries.length + resolved.length > 0`,
  // the resolved list is scrollback for a session that's already open, not
  // a second reason to summon the tray. The count badge below is `entries`
  // for the same reason — cleared history must never inflate it.
  const hasAlerts = entries.length > 0;
  const bad = worstSeverity === "bad";

  // Mounted a beat longer than `hasAlerts` so the last alert clearing gets a
  // fade-out instead of popping out of existence — same entrance/exit shape
  // as kiosk-attention.tsx's `entered` flag, just with an exit half too.
  const [mounted, setMounted] = useState(hasAlerts);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (hasAlerts) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    setEntered(false);
    const t = setTimeout(() => setMounted(false), prefersReducedMotion() ? KIOSK_REDUCED_MS : KIOSK_FADE_MS);
    return () => clearTimeout(t);
  }, [hasAlerts]);

  // Slow breathing-ring pulse, gated to `bad` only — a static colour swap
  // doesn't catch peripheral vision from across a room the way motion does,
  // but a `warn` that pulsed too would just be ambient noise competing with
  // the one condition that actually needs the glance. Reuses the glow
  // vocabulary globals.css already established for "this needs attention"
  // (.dot-unhealthy's pulse, .voice-mic-recording's breathing box-shadow
  // ring built from color-mix off a token) rather than inventing a new
  // visual language — replayed here via WAAPI instead of a new CSS
  // keyframe because this file doesn't own globals.css (another agent does).
  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node || !bad || prefersReducedMotion()) return;
    const anim = node.animate(
      [
        { boxShadow: "0 0 0 0 color-mix(in srgb, var(--color-bad) 50%, transparent)" },
        { boxShadow: "0 0 0 14px color-mix(in srgb, var(--color-bad) 0%, transparent)" },
      ],
      { duration: 1600, easing: "ease-in-out", iterations: Infinity },
    );
    return () => anim.cancel();
  }, [bad]);

  if (!mounted) return null;

  // `bad` gets a full fill, not a tint — the whole silhouette has to read as
  // "problem" at 2-3m, not just a small corner glyph. `warn` stays quieter
  // (a tint) so the two severities remain visually distinct, not just a
  // darker/lighter version of the same thing. The fill pairs `bg-bad` with
  // `text-bg` rather than the more obvious `text-ink` — CLAUDE.md's contrast
  // sweep already guarantees every status role (bad included) clears 4.5:1
  // against `bg` in all 16 themes, and WCAG contrast is symmetric, so
  // `--color-bg` text on a `--color-bad` fill inherits that SAME audited
  // ratio with the roles swapped — no new pairing to verify, and no risk of
  // the near-white-on-near-white failure a `bad`-on-`bad` (fill + text-bad)
  // combination would risk on themes where both are light-toned.
  const severityClasses = bad
    ? "border-transparent bg-bad text-bg"
    : worstSeverity === "warn"
      ? "border-warn/40 bg-warn/10 text-warn"
      : "border-line text-ink-dim hover:border-line-bright hover:bg-panel-2 hover:text-ink";

  // Reduced motion still needs a signal for `bad` — never "nothing appears"
  // — so the pulse is replaced with a static, heavier version of the same
  // ring at its brightest keyframe value, not dropped outright.
  const reducedBadRing =
    bad && prefersReducedMotion()
      ? { boxShadow: "0 0 0 4px color-mix(in srgb, var(--color-bad) 45%, transparent)" }
      : null;

  return (
    <button
      ref={setRefs}
      type="button"
      onClick={onPress}
      aria-expanded={trayOpen}
      aria-label={
        entries.length > 0
          ? `${entries.length} alert${entries.length === 1 ? "" : "s"} — worst ${worstSeverity === "bad" ? "critical" : "warning"}`
          : "Alerts"
      }
      // `fixed` escapes KioskThemeScope's safe-area padding (see
      // kiosk-glance.tsx's own note on this same constraint) — bake the
      // inset into this button's own offset rather than an ancestor's.
      style={{
        top: "calc(1rem + env(safe-area-inset-top))",
        right: "calc(1.25rem + env(safe-area-inset-right))",
        transitionDuration: `${KIOSK_FADE_MS}ms`,
        ...reducedBadRing,
      }}
      // min-h-14/min-w-14 is a FLOOR, not the target size — the icon/count
      // bump below grows the button past 56px via its own padding, which
      // only ever makes the tap target bigger than the contract requires,
      // never smaller or off-center from the visible glyph.
      //
      // z-(--z-toast), NOT z-(--z-sticky): this button is a floating overlay
      // control (fixed, always on top of page content), not a document-flow
      // element that merely sticks — full view's own `sticky top-0
      // z-(--z-sticky)` header sits in the SAME top-right region at the same
      // z-index, and same-index elements fall back to DOM order, which lets
      // the header win and swallow clicks meant for this button (found live:
      // Playwright's click retried for 5s reporting "header ... intercepts
      // pointer events"). Toast tier matches the tray this button opens, so
      // the button and its own tray always share one stacking tier above
      // ordinary page chrome.
      className={cn(
        "fixed z-(--z-toast) flex min-h-14 min-w-14 items-center justify-center gap-2 rounded-tile border px-4 py-2 outline-none transition-opacity ease-out motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98]",
        severityClasses,
        entered ? "opacity-100" : "opacity-0 motion-reduce:opacity-100",
      )}
    >
      <AlertTriangle size={28} aria-hidden />
      {entries.length > 0 && <span className="font-mono text-lg font-bold tabular-nums">{entries.length}</span>}
    </button>
  );
});

/* ── tray ────────────────────────────────────────────────────────────────── */

interface KioskAlertTrayProps {
  entries: KioskAlertEntry[];
  resolved: KioskResolvedAlertEntry[];
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
}

const AlertRow = forwardRef<HTMLDivElement, { entry: KioskAlertEntry }>(function AlertRow({ entry }, ref) {
  const sinceLabel = alertSinceLabel(entry.since);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="flex items-start gap-3 rounded-md px-2 py-2.5 outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <AlertTriangle
        size={16}
        className={cn("mt-0.5 shrink-0", entry.severity === "bad" ? "text-bad" : "text-warn")}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-sm font-medium text-ink">{entry.headline}</div>
        {entry.detail && <div className="text-xs text-ink-dim">{entry.detail}</div>}
      </div>
      {sinceLabel && (
        <span className="shrink-0 rounded-md bg-panel-2 px-2 py-1 font-mono text-2xs text-ink-dim tabular-nums">
          for {sinceLabel}
        </span>
      )}
    </div>
  );
});

const clearedTimeFormatter = new Intl.DateTimeFormat("en-AU", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** A retired alert's row — same content shape as AlertRow, deliberately
 *  de-emphasised: text-ink-dim throughout (no severity-tinted text or icon),
 *  no background tint at all, and its own timestamp reads "cleared HH:MM"
 *  rather than reusing AlertRow's "for <uptime>" tag — that tag means "still
 *  ongoing", which would misstate a condition that has since stopped. */
function ResolvedAlertRow({ entry }: { entry: KioskResolvedAlertEntry }) {
  return (
    <div className="flex items-start gap-3 rounded-md px-2 py-2 text-ink-dim">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 opacity-60" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-sm">{entry.headline}</div>
        {entry.detail && <div className="text-xs opacity-80">{entry.detail}</div>}
      </div>
      <span className="shrink-0 font-mono text-2xs tabular-nums">cleared {clearedTimeFormatter.format(entry.clearedAt)}</span>
    </div>
  );
}

export function KioskAlertTray({ entries, resolved, open, onClose, anchorRef }: KioskAlertTrayProps) {
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

  // Focus returns to the button specifically on the open→close transition,
  // not on every render — otherwise a re-render while already closed would
  // steal focus from whatever the user moved to next.
  useEffect(() => {
    if (wasOpenRef.current && !open) anchorRef.current?.focus();
    wasOpenRef.current = open;
  }, [open, anchorRef]);

  // Slide+fade in, WAAPI so it can be skipped outright under reduced motion
  // rather than authoring a second no-motion CSS path for the same rule.
  useLayoutEffect(() => {
    if (!open) return;
    const node = nodeRef.current;
    if (!node || prefersReducedMotion()) return;
    const anim = node.animate(
      [
        { opacity: 0, transform: "translateY(-6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 220, easing: KIOSK_EASE_OUT },
    );
    return () => anim.cancel();
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={nodeRef}
      role="dialog"
      aria-modal="false"
      aria-label="Alerts"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      onPointerDown={resetAutoClose}
      onKeyDownCapture={resetAutoClose}
      style={{
        top: "calc(1rem + 3.5rem + 0.75rem + env(safe-area-inset-top))",
        right: "calc(1.25rem + env(safe-area-inset-right))",
      }}
      className="fixed z-(--z-toast) panel w-[min(22rem,calc(100vw-2rem))] max-h-[60vh] overflow-y-auto p-2 outline-none"
    >
      {entries.map((entry, i) => (
        <AlertRow key={entry.id} entry={entry} ref={i === 0 ? firstRowRef : undefined} />
      ))}
      {resolved.length > 0 && (
        <>
          <div className="microlabel mt-1 border-t border-line px-2 pb-1.5 pt-2.5">Recently cleared</div>
          {resolved.map((entry) => (
            <ResolvedAlertRow key={`${entry.id}-${entry.clearedAt}`} entry={entry} />
          ))}
        </>
      )}
    </div>
  );
}

/* ── takeover ────────────────────────────────────────────────────────────── */

interface KioskAlertTakeoverProps {
  alert: KioskAlertEntry;
  onDismiss: () => void;
  minimiseTargetRef: RefObject<HTMLButtonElement | null>;
}

export function KioskAlertTakeover({ alert, onDismiss, minimiseTargetRef }: KioskAlertTakeoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dismissingRef = useRef(false);

  const dismiss = useCallback(() => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;

    const node = rootRef.current;
    const target = minimiseTargetRef.current;
    // flipOutTo itself returns null under prefers-reduced-motion, so this
    // only ever plays the shrink-into-the-button animation when both a
    // source and a live target exist and motion is allowed.
    const anim = node && target ? flipOutTo(node, target.getBoundingClientRect()) : null;
    if (anim) {
      anim.finished.then(onDismiss, onDismiss);
      return;
    }
    if (node && prefersReducedMotion()) {
      const fade = node.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: KIOSK_REDUCED_MS,
        easing: KIOSK_EASE_OUT,
        fill: "forwards",
      });
      fade.finished.then(onDismiss, onDismiss);
      return;
    }
    onDismiss();
  }, [minimiseTargetRef, onDismiss]);

  // Pop-in entrance: fade + scale 0.96→1. Run in a layout effect (before
  // paint) so the very first frame already reflects the animation's start
  // keyframe instead of flashing the fully-opaque end state for one frame.
  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node || prefersReducedMotion()) return;
    node.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "scale(1)" }], {
      duration: KIOSK_POP_MS,
      easing: KIOSK_EASE_OUT,
    });
  }, []);

  useEffect(() => {
    rootRef.current?.focus();
    const t = setTimeout(dismiss, TAKEOVER_MS);
    return () => clearTimeout(t);
  }, [dismiss]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  const sinceLabel = alertSinceLabel(alert.since);
  const severityText = alert.severity === "bad" ? "text-bad" : "text-warn";

  return (
    <>
      <div className="fixed inset-0 z-(--z-modal-backdrop) bg-bg/90 backdrop-blur-sm" aria-hidden />
      <div
        ref={rootRef}
        role="status"
        aria-live="assertive"
        tabIndex={-1}
        onClick={dismiss}
        className="fixed inset-0 z-(--z-modal) flex cursor-pointer flex-col items-center justify-center gap-4 px-8 text-center outline-none"
      >
        <AlertTriangle size={40} className={severityText} aria-hidden />
        {/* clamp(2rem, 6vw, 4rem) is a deliberate exception to DESIGN.md's
            type ramp, not a stray literal — same reasoning kiosk-clock.tsx
            gives its own off-ramp sizes: this is read from 2-3m away, the
            one thing on the wall an owner MUST see, and the ramp's largest
            documented step doesn't clear that distance. Contract-mandated,
            see redesign-06-space-and-modes.md's "A — alerts" spec. */}
        <p style={{ fontSize: "clamp(2rem, 6vw, 4rem)" }} className={cn("font-semibold leading-tight", severityText)}>
          {alert.headline}
        </p>
        {alert.detail && <p className="max-w-2xl text-2xl text-ink-dim">{alert.detail}</p>}
        {sinceLabel && <p className="microlabel">standing for {sinceLabel}</p>}
        <p className="microlabel mt-4">tap, or wait — dismisses on its own</p>
      </div>
    </>
  );
}

/* ── composition ─────────────────────────────────────────────────────────── */

export function KioskAlerts({ onOverlayStateChange }: { onOverlayStateChange?: (open: boolean) => void }) {
  const { entries, resolved, activeTakeover, dismissTakeover, worstSeverity } = useKioskAlerts();
  const [trayOpen, setTrayOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Only force-close when there is truly nothing left — no active alert AND
  // no resolved history. Closing purely on `entries.length === 0` would
  // yank the tray shut the instant the alert someone is reading clears,
  // right as its "cleared HH:MM" row lands in the resolved section below
  // it — the one moment a user is most likely mid-read. The button itself
  // still only renders while entries.length > 0 (see KioskAlertButton), so
  // an already-open tray surviving a resolve-to-empty transition doesn't
  // create a new way IN, only lets an existing session finish reading.
  useEffect(() => {
    if (entries.length === 0 && resolved.length === 0) setTrayOpen(false);
  }, [entries.length, resolved.length]);

  const overlayOpen = Boolean(activeTakeover) || trayOpen;
  useEffect(() => {
    onOverlayStateChange?.(overlayOpen);
  }, [overlayOpen, onOverlayStateChange]);

  return (
    <>
      <KioskAlertButton
        ref={buttonRef}
        entries={entries}
        worstSeverity={worstSeverity}
        trayOpen={trayOpen}
        onPress={() => setTrayOpen((o) => !o)}
      />
      <KioskAlertTray
        entries={entries}
        resolved={resolved}
        open={trayOpen}
        onClose={() => setTrayOpen(false)}
        anchorRef={buttonRef}
      />
      {activeTakeover && (
        // Keyed on identity: a second, different alert arriving immediately
        // after the first is dismissed gets its own fresh mount — its own
        // entrance animation and its own TAKEOVER_MS clock — rather than
        // reusing the outgoing instance mid-flight.
        <KioskAlertTakeover
          key={activeTakeover.id}
          alert={activeTakeover}
          onDismiss={() => dismissTakeover(activeTakeover.id)}
          minimiseTargetRef={buttonRef}
        />
      )}
    </>
  );
}

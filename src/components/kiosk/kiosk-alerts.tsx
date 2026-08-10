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

import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import useSWR from "swr";
import { AlertTriangle, X } from "lucide-react";
import { fetcher } from "@/lib/client";
import { KIOSK_IDLE_AFTER_MS, kioskEffectiveInterval, useKioskIdle, useKioskNight } from "@/lib/kiosk-activity";
import type { AttentionResult, AttentionSeverity } from "@/lib/attention";
import { formatUptime, formatWallClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  KIOSK_EASE_OUT,
  KIOSK_FADE_MS,
  KIOSK_POP_MS,
  KIOSK_PULSE_MS,
  KIOSK_REDUCED_MS,
  flipOutTo,
  prefersReducedMotion,
} from "@/lib/kiosk-motion";

// Idle/night backoff (2026-08 perf pass): an alert is the one thing on this
// surface that's supposed to interrupt you, which argues for keeping it
// fast — but "fast" only matters while a person might be nearby to see the
// takeover, and 60s/120s still land a bad condition on screen well within
// any reasonable idea of "promptly." Doesn't touch TAKEOVER_MS or
// TRAY_AUTO_CLOSE_MS below — those govern how long an ALREADY-SHOWN alert
// stands, not how often the condition is checked.
const POLL_MS_ACTIVE = 30_000;
const POLL_MS_IDLE = 60_000;
const POLL_MS_NIGHT = 120_000;
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
  /** Acknowledge an active alert — removes it from `entries` (and so from the
   *  tray and the button) until the reported condition changes. */
  dismissAlert: (id: string) => void;
  /** Remove one row from the cleared-history list. */
  dismissResolved: (id: string, clearedAt: number) => void;
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
  /** Ids the user has explicitly dismissed from the tray.
   *
   *  Dismissal still can't be a literal delete — nothing here OWNS an alert,
   *  `active` is re-derived from every poll of /kiosk/api/attention — so this
   *  is a suppression list, and it is what makes a dismissal look like a
   *  delete from the outside.
   *
   *  PERMANENT, as of 2026-08-05, and persisted (see readDismissed): the owner's
   *  report was that a dismissed alert came back. It did, three ways. It was
   *  component state, so any reload — a redeploy, a tablet refresh, the browser
   *  reclaiming the tab — started the list empty and re-showed a condition that
   *  was still standing (production's immich_server alert has been standing
   *  since 2026-08-04, so every single load re-raised it). A quiet poll cleared
   *  the whole list. And ids not currently reported were filtered out, so one
   *  transient quiet response was enough to lose the acknowledgement of a
   *  condition that came straight back.
   *
   *  All three are gone: the list is device-local storage, nothing prunes it on
   *  a quiet poll, and it outlives the condition. A dismissed id is dismissed.
   *
   *  What still re-alerts is a DIFFERENT id, and that is the whole safety
   *  mechanism: `alertId` is severity|headline|since, so a container that exits
   *  again gets a new `since`, and a disk that keeps filling gets a new
   *  percentage in its headline (see attention.ts) — both read as conditions
   *  nobody has acknowledged yet. The cost, stated plainly because it is real:
   *  a probe whose headline is fixed AND carries no `since` ("X is failing its
   *  healthcheck") is suppressed on this device for good once dismissed, even
   *  if it clears and returns. */
  dismissed: string[];
}

const EMPTY_STATE: AlertsState = { active: [], resolved: [], seeded: false, dismissed: [] };

/* ── dismissal persistence ─────────────────────────────────────────────────
   Device-local, exactly the idiom kiosk-theme.tsx and kiosk-widgets.tsx use for
   per-tablet preferences: plain localStorage, defensively parsed, and a write
   failure (private mode, quota) is swallowed rather than surfaced — a kiosk has
   nobody standing there to action an error, and the worst case is a dismissal
   that doesn't outlive the session, which is where this feature started.

   No CustomEvent broadcast, unlike those two: only this hook reads or writes the
   key, and one surface mounts it. */
const DISMISSED_STORAGE_KEY = "kiosk-alerts-dismissed";

/** Oldest-first cap. Suppressions accumulate forever by design, so the list
 *  needs SOME ceiling, and it is deliberately generous: this surface reports at
 *  most one condition at a time, so 200 distinct dismissed conditions is years
 *  of a normally-behaving homelab. Dropping the oldest is the right end to lose
 *  — the most recent dismissals are the ones whose conditions are most likely
 *  to still be standing. */
const DISMISSED_LIMIT = 200;

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(-DISMISSED_LIMIT);
  } catch {
    // Corrupt payload or storage unavailable — treated exactly like "nothing
    // dismissed", never as an error worth showing on a wall panel.
    return [];
  }
}

function writeDismissed(ids: string[]): void {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(ids.slice(-DISMISSED_LIMIT)));
  } catch {
    // non-persistent is fine
  }
}

export function useKioskAlerts(): UseKioskAlertsResult {
  const isIdle = useKioskIdle(KIOSK_IDLE_AFTER_MS);
  const isNight = useKioskNight();
  const pollMs = kioskEffectiveInterval({
    active: POLL_MS_ACTIVE,
    idle: POLL_MS_IDLE,
    night: POLL_MS_NIGHT,
    isIdle,
    isNight,
  });
  const { data } = useSWR<AttentionResult>("/kiosk/api/attention", fetcher, {
    refreshInterval: pollMs,
    keepPreviousData: true,
  });

  // Active, resolved and seeded live in ONE state object, updated by ONE pure
  // setState call per poll — not two+ separate setState calls, or a setState
  // paired with a ref write, where one leaks state the other depends on. See
  // the `seeded` field's own doc comment for the bug this replaced.
  const [state, setState] = useState<AlertsState>(EMPTY_STATE);

  /* Stored dismissals are read in an effect, not in a lazy useState
     initialiser: this page is statically prerendered, so anything touching
     localStorage during render runs on the server and throws. Same shape as
     every other stored preference on this surface (useKioskTheme,
     useKioskWidgetLayout).
     There is no flash of an already-dismissed alert while this lands, because
     nothing can be shown until the first poll RESOLVES — this effect runs on
     mount, the fetch takes a network round trip, and `data` is undefined until
     it returns. */
  useEffect(() => {
    const stored = readDismissed();
    if (stored.length > 0) setState((prev) => ({ ...prev, dismissed: stored }));
  }, []);

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
        // `dismissed` is carried through untouched. It used to be cleared here,
        // on the reasoning that nothing being reported means no acknowledgement
        // is still standing — but that is what made a dismissal temporary: one
        // quiet poll (including a transient) and the same standing condition
        // came back on the next one. A dismissed id stays dismissed; a genuinely
        // new occurrence arrives under a new id (see `dismissed`'s comment).
        return { ...prev, active: [], resolved, seeded: true };
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
      // `dismissed` carried through whole, for the same reason as the quiet
      // branch above: it used to be filtered down to ids still being reported,
      // which threw away every other acknowledgement the moment the probe moved
      // on to a different condition — and threw away THIS one too on any poll
      // that briefly reported something else.
      return { ...prev, active, resolved, seeded: true };
    });
  }, [data]);

  const dismissTakeover = useCallback((id: string) => {
    setState((prev) => ({ ...prev, active: prev.active.map((e) => (e.id === id ? { ...e, seen: true } : e)) }));
  }, []);

  /** Dismiss an active alert for good: it leaves the tray, the button and the
   *  takeover, survives reloads, and only ever comes back as a genuinely
   *  different condition (a new id). See `dismissed`'s doc comment.
   *
   *  The write to storage happens inside the updater rather than in an effect on
   *  `state.dismissed`, so what gets persisted is exactly the list this
   *  transition produced — an effect would also fire for the hydration pass,
   *  writing back what it had just read. */
  const dismissAlert = useCallback((id: string) => {
    setState((prev) => {
      if (prev.dismissed.includes(id)) return prev;
      const dismissed = [...prev.dismissed, id].slice(-DISMISSED_LIMIT);
      writeDismissed(dismissed);
      return { ...prev, dismissed };
    });
  }, []);

  /** Drop one row from the cleared-history list. This one IS a true delete —
   *  resolved entries are owned here and nothing re-derives them. */
  const dismissResolved = useCallback((id: string, clearedAt: number) => {
    setState((prev) => ({
      ...prev,
      resolved: prev.resolved.filter((e) => !(e.id === id && e.clearedAt === clearedAt)),
    }));
  }, []);

  // Everything downstream — tray rows, the button, the count badge and the
  // severity that drives the pulse — reads the FILTERED list, so acknowledging
  // the last standing alert genuinely takes the button off the screen rather
  // than leaving a badge showing zero.
  const entries = useMemo(
    () => state.active.filter((e) => !state.dismissed.includes(e.id)),
    [state.active, state.dismissed],
  );

  /* The takeover checks `dismissed` too, which it did not have to before.
     The old reasoning — a takeover only fires for an id the user has not seen,
     and an unseen id cannot have been dismissed — held only while dismissals
     died with the session and with the condition. Now they persist: a condition
     dismissed yesterday that stops being reported and is reported again gets
     `seen: false` on that poll (it is a fresh entry in `active`), and without
     this check it would take over the whole screen. Nothing the user has
     permanently dismissed may seize the display. */
  const activeTakeover = state.active.find((e) => !e.seen && !state.dismissed.includes(e.id)) ?? null;
  const worstSeverity: AttentionSeverity | null = entries.some((e) => e.severity === "bad")
    ? "bad"
    : entries.length > 0
      ? "warn"
      : null;

  return {
    entries,
    resolved: state.resolved,
    activeTakeover,
    dismissTakeover,
    dismissAlert,
    dismissResolved,
    worstSeverity,
  };
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
      return;
    }
    setEntered(false);
    const t = setTimeout(() => setMounted(false), prefersReducedMotion() ? KIOSK_REDUCED_MS : KIOSK_FADE_MS);
    return () => clearTimeout(t);
  }, [hasAlerts]);

  // Split from the effect above rather than firing setEntered from inside it:
  // this button doesn't exist in the DOM until `mounted` itself commits (see
  // the `if (!mounted) return null` below), so `innerRef` is still null on
  // the same effect run that flips `mounted` true. Keying a second effect on
  // `mounted` lets it run AFTER that commit, once the node is real — then a
  // forced reflow (not a single rAF; see kiosk-spark.tsx's useGlide for the
  // measured rAF-coalescing failure this replaces) commits the opacity-0
  // resting style before `entered` flips, so the fade-in has a real "before"
  // to transition from instead of sometimes skipping straight to opacity-100.
  useEffect(() => {
    if (!mounted) return;
    const node = innerRef.current;
    if (node) void node.getBoundingClientRect();
    setEntered(true);
  }, [mounted]);

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
      // KIOSK_PULSE_MS, shared with .voice-mic-recording's CSS ring — one
      // "recording/alerting" cadence, not two that can drift apart.
      { duration: KIOSK_PULSE_MS, easing: "ease-in-out", iterations: Infinity },
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
        transitionTimingFunction: KIOSK_EASE_OUT,
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
        // kiosk-press replaces active:scale-[0.98] (see globals.css's KIOSK
        // MOTION VOCABULARY). `transition-opacity ease-out
        // motion-reduce:transition-none` stays: opacity is NOT in
        // `.kiosk-press`'s own transition property list, and this is the
        // transition that drives the button's mount/unmount fade (`entered`
        // below) — it is load-bearing, not a leftover.
        "fixed z-(--z-toast) flex min-h-14 min-w-14 items-center justify-center gap-2 rounded-tile border px-4 py-2 outline-none kiosk-press transition-opacity motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-accent",
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
  /** Acknowledge an active alert. See `dismissAlert` in useKioskAlerts. */
  onDismissAlert: (id: string) => void;
  /** Remove a cleared row from history. */
  onDismissResolved: (id: string, clearedAt: number) => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
}

/** The dismiss affordance shared by both row kinds. 44px square rather than
 *  the 56px this surface uses for primary touch targets: a tray row is
 *  secondary, reached only after deliberately opening the tray, and a 56px
 *  button would be taller than the row it sits in. 44px is still at or above
 *  every published minimum, and the whole row is only ~56px tall itself. */
function DismissButton({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        // The tray closes on outside-press and resets its auto-close timer on
        // any press inside; neither should treat a dismiss as "the user is
        // reading this, keep it open longer" once the row is gone.
        e.stopPropagation();
        onDismiss();
      }}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-faint outline-none transition hover:bg-panel-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
    >
      <X size={16} aria-hidden />
    </button>
  );
}

const AlertRow = forwardRef<HTMLDivElement, { entry: KioskAlertEntry; onDismiss: () => void }>(function AlertRow(
  { entry, onDismiss },
  ref,
) {
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
        <span className="shrink-0 self-center rounded-md bg-panel-2 px-2 py-1 font-mono text-2xs text-ink-dim tabular-nums">
          for {sinceLabel}
        </span>
      )}
      <DismissButton label={`Dismiss alert: ${entry.headline}`} onDismiss={onDismiss} />
    </div>
  );
});

function clearedWallClock(clearedAt: number): string {
  const { time, period } = formatWallClock(new Date(clearedAt));
  return `${time} ${period}`;
}

/** A retired alert's row — same content shape as AlertRow, deliberately
 *  de-emphasised: text-ink-dim throughout (no severity-tinted text or icon),
 *  no background tint at all, and its own timestamp reads "cleared h:mm am/pm"
 *  rather than reusing AlertRow's "for <uptime>" tag — that tag means "still
 *  ongoing", which would misstate a condition that has since stopped. It shares
 *  formatWallClock with the kiosk clock rather than owning a formatter: two
 *  times-of-day on one screen in different conventions reads as a bug. Joined
 *  with a plain space here, not the clock's scaled span — at text-2xs there is
 *  no size gap left to express, and the marker is part of the reading. */
function ResolvedAlertRow({ entry, onDismiss }: { entry: KioskResolvedAlertEntry; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-md px-2 py-2 text-ink-dim">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 opacity-60" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-sm">{entry.headline}</div>
        {entry.detail && <div className="text-xs opacity-80">{entry.detail}</div>}
      </div>
      <span className="shrink-0 self-center font-mono text-2xs tabular-nums">
        cleared {clearedWallClock(entry.clearedAt)}
      </span>
      <DismissButton label={`Remove from history: ${entry.headline}`} onDismiss={onDismiss} />
    </div>
  );
}

export function KioskAlertTray({ entries, resolved, open, onClose, onDismissAlert, onDismissResolved, anchorRef }: KioskAlertTrayProps) {
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

  // Dismissing the last row leaves `open` true with nothing to show, so the
  // tray has to close itself rather than waiting out its 20s auto-close as an
  // invisible node that still owns focus.
  useEffect(() => {
    if (open && entries.length === 0 && resolved.length === 0) onClose();
  }, [open, entries.length, resolved.length, onClose]);

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
      // KIOSK_POP_MS, not a bespoke 220 — this is an overlay entrance (the
      // token's own name), and the 220 it replaces carried no documented
      // reason to differ from the rest of the vocabulary's pop-ins.
      { duration: KIOSK_POP_MS, easing: KIOSK_EASE_OUT },
    );
    return () => anim.cancel();
  }, [open]);

  /* A tray with nothing in it is not a tray, it's an empty box floating in the
     corner. This can genuinely happen — dismiss the last active alert while
     the history is also empty, or open it just as the final row is
     acknowledged — so emptiness is checked here rather than assumed away by
     the button's own visibility. The effect above closes it too, so `open`
     doesn't stay stuck true behind a component that renders nothing. */
  const isEmpty = entries.length === 0 && resolved.length === 0;
  if (!open || isEmpty) return null;

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
        <AlertRow key={entry.id} entry={entry} ref={i === 0 ? firstRowRef : undefined} onDismiss={() => onDismissAlert(entry.id)} />
      ))}
      {resolved.length > 0 && (
        <>
          <div className="microlabel mt-1 border-t border-line px-2 pb-1.5 pt-2.5">Recently cleared</div>
          {resolved.map((entry) => (
            <ResolvedAlertRow key={`${entry.id}-${entry.clearedAt}`} entry={entry} onDismiss={() => onDismissResolved(entry.id, entry.clearedAt)} />
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
    const anim = node.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "scale(1)" }], {
      duration: KIOSK_POP_MS,
      easing: KIOSK_EASE_OUT,
    });
    return () => anim.cancel();
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
  const { entries, resolved, activeTakeover, dismissTakeover, dismissAlert, dismissResolved, worstSeverity } =
    useKioskAlerts();
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
        onDismissAlert={dismissAlert}
        onDismissResolved={dismissResolved}
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

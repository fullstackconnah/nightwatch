"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Pause, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { AnsiText, stripAnsi } from "@/components/ansi";
import {
  CLOCK_TICK_MS,
  LEVEL_CODE,
  LEVEL_LABEL,
  LEVEL_ORDER,
  RATE_WINDOW_MS,
  type LogLevel,
  type LogLine,
  type LogTrackState,
} from "@/lib/log-types";

/**
 * One container's full-width band. The header answers "is this thing alive"
 * honestly even when it has nothing to say — at ~17 lines/minute across the
 * whole host, a quiet-but-connected track is the normal reading, not a dead
 * one, so `live` never collapses into a bare "no data" state.
 */

const NEAR_BOTTOM_PX = 24;
// Built via fromCharCode rather than a literal zero-width space in source: a
// bare ZWSP character is a single invisible byte a future edit (or a
// careless retype of this file) could delete or corrupt without the diff
// showing anything readable. See the announcer's live-region render for why
// it exists.
const ZERO_WIDTH_SPACE = String.fromCharCode(8203);

/** How close to the bottom counts as "still following". Read on both the
 *  scroll handler and the arrival effect so the two agree on what "stuck"
 *  means. */
function isNearBottom(el: HTMLDivElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

function StatusReadout({ state, newest }: { state: LogTrackState | undefined; newest: LogLine | undefined }) {
  const status = state?.status ?? "connecting";

  if (status === "connecting") {
    return <span className="text-xs text-ink-dim">connecting…</span>;
  }
  if (status === "ended") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge variant="neutral">exited</Badge>
        {state?.detail && <span className="text-xs text-ink-faint">{state.detail}</span>}
      </span>
    );
  }
  if (status === "error" || status === "lost") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge variant={status === "error" ? "bad" : "warn"}>{status}</Badge>
        {state?.detail && <span className="text-xs text-ink-faint">{state.detail}</span>}
      </span>
    );
  }
  // live — the truthful case, and the one that matters most: a healthy
  // stream with nothing arriving must never read the same as a dead one.
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-dim">
      <span className="dot dot-running" />
      live · {newest ? (
        <>
          {/* No memo/interval of its own: LogTrack's shared CLOCK_TICK_MS
              timer re-renders this whole subtree on every tick, so
              relativeTime recomputes for free — a second clock here would
              tick the same decision twice for no reason. */}
          last line {relativeTime(newest.ts)}
        </>
      ) : (
        "waiting for the first line"
      )}
    </span>
  );
}

function LogRow({
  line,
  ansi,
  highlight,
  arrived,
}: {
  line: LogLine;
  ansi: boolean;
  highlight: RegExp | null;
  arrived: boolean;
}) {
  const time = new Date(line.ts);
  const hh = String(time.getHours()).padStart(2, "0");
  const mm = String(time.getMinutes()).padStart(2, "0");
  const ss = String(time.getSeconds()).padStart(2, "0");

  const levelClass: Record<LogLevel, string> = {
    debug: "text-ink-faint",
    info: "text-ink-dim",
    warn: "text-warn",
    error: "text-bad",
    none: "text-ink-faint",
  };

  return (
    <div
      className={cn(
        "flex gap-2 px-2 py-px",
        // stderr marker: a 1px inset ring rather than a thicker coloured border,
        // which this project bans as a device — a hairline reads as "different
        // channel", a fat one reads as "alert", and stderr is neither.
        line.stream === "stderr" && "shadow-[inset_1px_0_0_var(--color-line-bright)]",
        arrived && "log-arrival",
      )}
    >
      <span className="shrink-0 text-ink-faint tabular-nums">{hh}:{mm}:{ss}</span>
      <span className={cn("shrink-0 w-8", levelClass[line.level])}>{LEVEL_CODE[line.level]}</span>
      {/*
        Colour lives in the gutter only. The message column belongs to ANSI —
        letting level colour the body too would mean two systems fighting over
        the same pixels, and the container's own colour (docker's actual
        output) is the one worth trusting there.
      */}
      <span className="min-w-0 flex-1 text-ink">
        <AnsiText text={line.text} ansi={ansi} highlight={highlight} />
      </span>
    </div>
  );
}

export function LogTrack({
  container,
  state,
  lines,
  levels,
  highlight,
  query,
  ansi,
  collapsed,
  onToggleCollapse,
  onRemove,
  dense,
  short,
  seedCount,
  seeded,
}: {
  container: string;
  state: LogTrackState | undefined;
  /** this container's whole unfiltered buffer, oldest first */
  lines: LogLine[];
  /** which levels are currently enabled */
  levels: Set<LogLevel>;
  /** compiled search regex, or null when the box is empty or the pattern is invalid */
  highlight: RegExp | null;
  /** the raw text the user typed, for the "nothing matches …" copy */
  query: string;
  ansi: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRemove: () => void;
  /** true when more than 3 tracks are on screen — shrinks the body height */
  dense: boolean;
  /** true when this container had fewer lines than the requested tail — the
   *  seed the reader is looking at IS the container's entire history, not a
   *  truncated window. Optional and additive: existing callers compile
   *  unchanged until wired up. */
  short?: boolean;
  /** How many lines the seed carried — the number to quote next to `short`.
   *  `lines.length` is the wrong number for that note: it grows with every
   *  live arrival, so a container seeded with 37 lines (`short: true`) that
   *  then receives 5 more would claim "only 42 lines exist", contradicting
   *  both the flag beside it and what `short` actually describes (see
   *  useLogStream's `seedCount` doc comment). Don't "simplify" the note back
   *  to `lines.length`. */
  seedCount?: number;
  /** True as soon as this container's seed event has landed, even if it
   *  carried zero lines — distinct from "the buffer is non-empty". Drives
   *  when the arrival latch below fires; see that effect for why a container
   *  with no scrollback needs this rather than a non-empty check. Optional:
   *  when omitted, the track falls back to latching on the first non-empty
   *  `lines` array so it still works standalone. */
  seeded?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Three independent reasons a track can stop following the tail: the reader
  // scrolled away from the bottom, the reader is hovering to read in peace, or
  // the reader hit the explicit pause control. Any one of them is enough.
  const [stickToBottom, setStickToBottom] = useState(true);
  const [manualPause, setManualPause] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [touching, setTouching] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const seenIds = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const status = state?.status ?? "connecting";
  const paused = manualPause || hovering || touching || !stickToBottom;

  // Shared clock for this track, ticking on the same CLOCK_TICK_MS cadence
  // as log-console's rate readout (one constant, imported from log-types, so
  // the two components can't quietly drift into two different decisions).
  // Both the rate readout below and StatusReadout's "last line …ago" need to
  // notice time passing even when nothing new arrives — a quiet track is the
  // normal case here — so this is one timer the whole track re-renders on,
  // rather than each consumer running its own private interval.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Compact, screen-reader-only summary of what just arrived — never the
  // message text itself, which reaches 549 characters on this host's worst
  // offender (immich_postgres). Populated from the same "is this an arrival"
  // signal the animation uses, so the seed never announces.
  //
  // Carries a `seq` alongside `text` because two consecutive arrivals often
  // produce the EXACT same sentence (e.g. two single-line arrivals in a row,
  // the modal case at ~17 lines/min across the fleet) — setting React state
  // to a string equal to its current value is a no-op, so the DOM text node
  // would never actually change and aria-live would have nothing to notice.
  // `seq` is rendered as an invisible parity marker below so the live
  // region's content genuinely differs every time, even when the words don't.
  const [announcement, setAnnouncement] = useState<{ text: string; seq: number }>({ text: "", seq: 0 });

  // Stripped text per line, cached by id and recomputed only when `lines`
  // grows — not on every keystroke in the filter box, which is the
  // highest-frequency dependency here.
  const strippedById = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lines) map.set(l.id, stripAnsi(l.text));
    return map;
  }, [lines]);

  const filtered = useMemo(() => {
    return lines.filter((l) => {
      if (!levels.has(l.level)) return false;
      if (highlight === null) return true;
      // Cloning (via a fresh regex built from source+flags) rather than reusing
      // the caller's instance: a `/g` regex carries `lastIndex` between .test()
      // calls, so testing the same instance across many lines silently skips
      // every other match — the classic stateful-regex trap.
      const re = new RegExp(highlight.source, highlight.flags);
      // Match against the same string AnsiText renders — l.text deliberately
      // keeps ANSI escapes (log-types.ts), but stripAnsi(text) is what a
      // reader actually sees whether ansi replay is on or off. Testing the
      // raw string lets a pattern match invisible escape bytes on the 8
      // containers that emit colour, or silently miss a match spanning a
      // colour boundary.
      return re.test(strippedById.get(l.id) ?? l.text);
    });
  }, [lines, levels, highlight, strippedById]);

  // Level-format honesty note: some containers never emit a level at all, and
  // once the buffer is long enough to trust that as a fact (not just "hasn't
  // happened yet"), say so — otherwise a `none`-only container with the level
  // filters at their default looks identical to a broken track.
  const allNoLevel = lines.length >= 20 && lines.every((l) => l.level === "none");

  const rate1min = useMemo(() => {
    const since = Date.now() - RATE_WINDOW_MS;
    let n = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].ts < since) break;
      n++;
    }
    return n;
    // `tick` is a dependency purely to force recomputation every
    // CLOCK_TICK_MS — without it this freezes at whatever it was on the last
    // arrival, and a 200-line seed landing inside the last minute would read
    // "200/min" forever on a host this quiet.
  }, [lines, tick]);

  // Growth of the raw buffer (not the filtered view) is what "N new lines"
  // counts — toggling a level pill changes `filtered.length` without a
  // single new line having arrived, and that must never masquerade as new
  // arrivals held back.
  const prevLineCountRef = useRef(lines.length);
  useEffect(() => {
    const grew = lines.length - prevLineCountRef.current;
    prevLineCountRef.current = lines.length;
    const el = scrollRef.current;
    if (!el || collapsed) return;
    if (paused) {
      if (grew > 0) setPendingCount((n) => n + grew);
      return;
    }
    // Not paused — whether because we were already following, or because a
    // pause reason just cleared (mouse left, filter caught up) — catch up to
    // the tail and clear the held-back count.
    el.scrollTop = el.scrollHeight;
    setPendingCount(0);
  }, [lines.length, collapsed, paused]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // The single source of truth for "is the reader still following": this
    // fires on every scroll, including the programmatic one above, so it
    // naturally re-confirms `stickToBottom` after we move the view.
    setStickToBottom(isNearBottom(el));
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setPendingCount(0);
    setStickToBottom(true);
    setManualPause(false);
  }

  // Which line ids have already played the arrival animation, so a re-render
  // triggered by something other than a new line (a level pill, a search
  // edit) never re-animates old scrollback. Membership is read live during
  // render; the set itself is only mutated after commit, in the effect
  // below — mutating a ref mid-render is unsafe under Strict Mode's
  // double-invoke, which would mark the first line "seen" on a throwaway
  // pass and silently skip its animation for real.
  const arrivedIds = useMemo(() => {
    if (!seededRef.current) return new Set<string>();
    const arrived = new Set<string>();
    for (const l of filtered) {
      if (!seenIds.current.has(l.id)) arrived.add(l.id);
    }
    return arrived;
  }, [filtered]);

  useEffect(() => {
    if (seededRef.current) return;
    // Latch on the SEED EVENT itself, not on "the buffer became non-empty".
    // Those differ for exactly the container that matters most: one with NO
    // scrollback. Its seed carries zero lines, so a non-empty check would
    // never latch on connect — the first line it ever logs would land, find
    // seenIds empty, and get filed as "seed" instead of "arrival", the one
    // case StatusReadout's "waiting for the first line" copy is about.
    //
    // `seeded` becomes true the instant that container's (possibly empty)
    // seed lands, so we can latch here-and-now: record whatever ids are
    // present at this moment (maybe none) as already-seen, and everything
    // that shows up afterwards — including that very first live line — is a
    // genuine arrival.
    //
    // Falls back to the old first-non-empty-batch behaviour when `seeded` is
    // not wired up by the caller, so the component still works standalone.
    if (seeded === undefined) {
      if (lines.length === 0) return;
    } else if (!seeded) {
      return;
    }
    for (const l of lines) seenIds.current.add(l.id);
    seededRef.current = true;
  }, [seeded, lines]);

  // Screen-reader announcement for genuinely new lines only, grouped by
  // level and counted (never the message text — see the state comment
  // above). Reuses arrivedIds so the seed and any level-toggle-induced
  // re-filter never announce, only real arrivals do.
  useEffect(() => {
    if (arrivedIds.size === 0) return;
    const counts = new Map<LogLevel, number>();
    for (const l of filtered) {
      if (arrivedIds.has(l.id)) counts.set(l.level, (counts.get(l.level) ?? 0) + 1);
    }
    const parts = [...counts.entries()].map(
      ([level, n]) => `${n} new ${LEVEL_LABEL[level]} ${n === 1 ? "line" : "lines"}`,
    );
    if (parts.length === 0) return;
    setAnnouncement((prev) => ({ text: `${container}: ${parts.join(", ")}`, seq: prev.seq + 1 }));
  }, [arrivedIds, filtered, container]);

  // Clear the announcement a few seconds after it lands rather than leaving
  // it to sit in the accessibility tree forever — an unbounded announcement
  // is a stale claim ("3 new info lines") that stays true only for the
  // instant it was made. Depending on the whole `announcement` object means
  // a fresh arrival (new `seq`) reschedules this via the cleanup below
  // instead of racing the old timer to clear text a new arrival just set.
  useEffect(() => {
    if (!announcement.text) return;
    const id = setTimeout(() => {
      setAnnouncement((prev) => ({ text: "", seq: prev.seq }));
    }, 5000);
    return () => clearTimeout(id);
  }, [announcement]);

  const newest = lines.length > 0 ? lines[lines.length - 1] : undefined;
  const bodyHeight = dense ? "11rem" : "17rem";

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 border-b border-line">
        <span className="font-mono text-sm font-medium text-ink truncate">{container}</span>
        <StatusReadout state={state} newest={newest} />
        <span className="font-mono text-xs text-ink-dim tabular-nums">{rate1min}/min</span>
        <span className="font-mono text-xs text-ink-faint tabular-nums">
          {highlight || levels.size < LEVEL_ORDER.length
            ? `showing ${filtered.length} of ${lines.length}`
            : `${lines.length} lines`}
        </span>

        {allNoLevel && (
          <span className="text-xs text-ink-faint italic">
            no level in this container&apos;s output — level filters won&apos;t narrow it
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* Explicit pause control: the only way to reach the pause/resume
              behaviour without a pointer, since hover has no touch equivalent. */}
          <button
            type="button"
            onClick={() => setManualPause((v) => !v)}
            aria-pressed={manualPause}
            aria-label={manualPause ? `Resume autoscroll for ${container}` : `Pause autoscroll for ${container}`}
            title={manualPause ? "Resume autoscroll" : "Pause autoscroll"}
            className="h-11 w-11 md:h-7 md:w-7 grid place-items-center rounded-md text-ink-faint hover:text-ink hover:bg-panel-2 cursor-pointer"
          >
            {manualPause ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? `Expand ${container}` : `Collapse ${container}`}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand" : "Collapse"}
            className="h-11 w-11 md:h-7 md:w-7 grid place-items-center rounded-md text-ink-faint hover:text-ink hover:bg-panel-2 cursor-pointer"
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Stop watching ${container}`}
            title="Stop watching"
            className="h-11 w-11 md:h-7 md:w-7 grid place-items-center rounded-md text-ink-faint hover:text-bad hover:bg-bad/10 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="relative">
          {/* role="log" + aria-live="off": the region itself is not the live
              channel — a 200-line seed announcing itself on connect would be
              unusable. The sr-only element below is the real aria-live
              announcer, and it only speaks for genuine arrivals (see the
              `announcement` effect above). */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            onTouchStart={() => setTouching(true)}
            onTouchEnd={() => setTouching(false)}
            tabIndex={0}
            role="log"
            aria-live="off"
            aria-label={`${container} log output`}
            className="logbox overflow-y-auto py-1 outline-none focus-visible:ring-1 focus-visible:ring-accent"
            style={{ height: bodyHeight }}
          >
            {status === "error" && lines.length === 0 ? (
              <div className="px-3 py-6 text-xs text-ink-faint">
                {state?.detail ?? `couldn't connect to ${container}.`} Try removing and re-adding
                the container from the rail.
              </div>
            ) : lines.length === 0 ? (
              <div className="px-3 py-6 text-xs text-ink-faint">
                {status === "live"
                  ? "waiting for the first line — quiet is normal here."
                  : status === "connecting"
                    ? "reading scrollback…"
                    : status === "ended"
                      ? "this container exited without logging anything."
                      : "connection lost before any line arrived."}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-6 text-xs text-ink-faint">
                {query
                  ? `no line matches /${query}/ in the last ${lines.length} lines.`
                  : `every line in the last ${lines.length} is filtered out — ${levelsOffNote(levels)}.`}
              </div>
            ) : (
              <>
                {short && (
                  // The seed came back short of the requested tail — this
                  // *is* the container's entire history, not a truncated
                  // window. Worth saying on a quiet box, where "only 37
                  // lines" is itself the useful fact.
                  //
                  // Quotes `seedCount`, NOT `lines.length`: the buffer keeps
                  // growing with every live arrival, so a container seeded
                  // short at 37 lines that then gets 5 more would read "only
                  // 42 lines exist" — a number that contradicts `short`
                  // itself, which describes the seed at connect time and
                  // never the live stream (see useLogStream's doc comment).
                  // Falls back to `lines.length` only when the caller hasn't
                  // wired the prop up yet.
                  <div className="px-3 py-1 text-[0.7rem] text-ink-faint italic">
                    only {seedCount ?? lines.length} lines exist for this container
                  </div>
                )}
                {filtered.map((l) => (
                  <LogRow
                    key={l.id}
                    line={l}
                    ansi={ansi}
                    highlight={highlight}
                    arrived={arrivedIds.has(l.id)}
                  />
                ))}
              </>
            )}
          </div>

          {/* Visually-hidden live region: the actual aria-live announcer,
              separate from the log body's aria-live="off" above. sr-only
              (not display:none/visibility:hidden) so it stays in the
              accessibility tree while being invisible on screen. */}
          <div aria-live="polite" className="sr-only">
            {announcement.text}
            {/* Zero-width space, toggled by seq parity: silent to a screen
                reader but enough to change the DOM text node when two
                arrivals in a row produce byte-identical wording, so the
                live region is genuinely mutated and gets announced again. */}
            {announcement.seq % 2 === 1 ? ZERO_WIDTH_SPACE : ""}
          </div>

          {pendingCount > 0 && (
            <button
              type="button"
              onClick={jumpToLatest}
              className="absolute bottom-2 right-2 h-11 md:h-8 px-2.5 rounded-md bg-panel-2 border border-line-bright text-[0.7rem] font-mono text-accent hover:border-accent/50 cursor-pointer shadow-sm"
            >
              {pendingCount} new {pendingCount === 1 ? "line" : "lines"} · jump to latest
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Names the levels currently switched off, so a fully-filtered track says
 *  why instead of just looking broken. */
function levelsOffNote(levels: Set<LogLevel>): string {
  const off = LEVEL_ORDER.filter((l) => !levels.has(l));
  if (off.length === 0) return "no levels are enabled";
  return `${off.join(", ")} ${off.length === 1 ? "is" : "are"} switched off`;
}

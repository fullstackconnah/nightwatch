"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Baseline, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, formatNumber, formatUptime } from "@/lib/format";
import { SegmentButton } from "@/components/ui/segment-button";
import { ContainerRail, type RailContainer } from "@/components/container-rail";
import { LogTrack } from "@/components/log-track";
import { hasAnsi } from "@/components/ansi";
import { useLogStream, type LogConnection } from "@/lib/use-log-stream";
import { useLogArchive } from "@/lib/use-log-archive";
import { ARCHIVE_LINE_CAP } from "@/lib/log-archive";
import {
  LEVEL_LABEL,
  LEVEL_ORDER,
  CLOCK_TICK_MS,
  LEVEL_CODE,
  LOG_TAIL_DEFAULT,
  MAX_TRACKS,
  RATE_WINDOW_MS,
  type LogLevel,
} from "@/lib/log-types";

/**
 * The console shell: rail above, filters across, tracks stacked on the floor.
 *
 * Order is the argument. The rail is the roster of everything on the box; the
 * toolbar is what you are asking of it; the floor below holds one full-width
 * track per container you took off the rail. Nothing on this page is a grid of
 * equal cards, because the containers are not equals here — the ones on the
 * floor are the ones you chose to watch.
 */

const LS_SELECTION = "nightwatch.logs.selection";
const LS_LEVELS = "nightwatch.logs.levels";
const LS_ANSI = "nightwatch.logs.ansi";

function readStoredSelection(): string[] | null {
  try {
    const raw = window.localStorage.getItem(LS_SELECTION);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

function readStoredLevels(): Set<LogLevel> | null {
  try {
    const raw = window.localStorage.getItem(LS_LEVELS);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter((v): v is LogLevel =>
      LEVEL_ORDER.includes(v as LogLevel),
    );
    // An empty stored set is treated as "nothing usable stored" rather than as a
    // deliberate all-off state. That is a judgement, not an oversight: all-off
    // shows nothing at all, and restoring a blank floor on a later visit reads as
    // a broken page. The toolbar still lets you switch everything off in session.
    return valid.length > 0 ? new Set(valid) : null;
  } catch {
    return null;
  }
}

export function LogConsole({
  containers,
  initialSelection,
}: {
  containers: RailContainer[];
  /** From `?c=` — a deep link from a container's detail page wins over whatever
   *  was last watched, because the link is a fresh, explicit intent. */
  initialSelection: string[];
}) {
  const known = useMemo(() => new Set(containers.map((c) => c.name)), [containers]);

  const [selected, setSelected] = useState<string[]>(() =>
    initialSelection.filter((n) => known.has(n)).slice(0, MAX_TRACKS),
  );
  const [levels, setLevels] = useState<Set<LogLevel>>(() => new Set(LEVEL_ORDER));
  const [ansi, setAnsi] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement | null>(null);
  const restored = useRef(false);

  // Restore the last sitting on mount, not during render: this console is a
  // habit — you come back to the same two or three containers — and retyping the
  // selection every visit is the kind of friction that gets a tool abandoned.
  // A `?c=` deep link suppresses the restore rather than merging with it.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const storedLevels = readStoredLevels();
    if (storedLevels) setLevels(storedLevels);
    const storedAnsi = window.localStorage.getItem(LS_ANSI);
    if (storedAnsi === "0") setAnsi(false);
    if (initialSelection.length > 0) return;
    const stored = readStoredSelection();
    if (stored) setSelected(stored.filter((n) => known.has(n)).slice(0, MAX_TRACKS));
  }, [initialSelection, known]);

  useEffect(() => {
    if (!restored.current) return;
    window.localStorage.setItem(LS_SELECTION, JSON.stringify(selected));
    // Keep the address bar in step so the current view is shareable and a reload
    // lands on the same floor. replaceState, not push: choosing containers is
    // not navigation and should not fill the back button with selections.
    const url = new URL(window.location.href);
    if (selected.length > 0) url.searchParams.set("c", selected.join(","));
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
  }, [selected]);

  useEffect(() => {
    if (!restored.current) return;
    window.localStorage.setItem(LS_LEVELS, JSON.stringify([...levels]));
    window.localStorage.setItem(LS_ANSI, ansi ? "1" : "0");
  }, [levels, ansi]);

  // `/` focuses the filter, the way every console the reader already uses does.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      e.preventDefault();
      filterRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { lines, tracks, connection, arrivals, short, seedCount } = useLogStream(selected);

  // Everything that arrives is written through to IndexedDB. The console never
  // waits on it: if the archive cannot open, this surface is exactly the live
  // console it was before persistence existed.
  const archive = useLogArchive(lines);
  const [confirmPurge, setConfirmPurge] = useState(false);

  useEffect(() => {
    if (!confirmPurge) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirmPurge(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmPurge]);

  // An invalid pattern is a half-typed one. Applying nothing and saying so keeps
  // the floor readable while you type `(err` — blanking every track mid-keystroke
  // would make the filter feel broken at exactly the moment it is being used.
  const { highlight, patternBroken } = useMemo(() => {
    const t = query.trim();
    if (!t) return { highlight: null, patternBroken: false };
    try {
      return { highlight: new RegExp(t, "gi"), patternBroken: false };
    } catch {
      return { highlight: null, patternBroken: true };
    }
  }, [query]);

  const levelCounts = useMemo(() => {
    const counts: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      none: 0,
    };
    for (const name of selected) {
      for (const line of lines[name] ?? []) counts[line.level]++;
    }
    return counts;
  }, [lines, selected]);

  // "Lines in the last minute" describes a window that keeps moving whether or
  // not anything arrives, so it cannot be derived from arrivals alone: with a
  // memo keyed only on `lines`, a quiet floor would keep reporting the figure
  // from the last arrival indefinitely — and on this box a 45-second silence
  // across all 26 containers is measured, normal behaviour. Worse on connect,
  // where a 200-line tail timestamped inside the last minute would read as a
  // live rate of 200/min. The tick makes the number decay honestly to zero.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (selected.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [selected.length]);

  const ratePerMin = useMemo(() => {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    let n = 0;
    for (const name of selected) {
      for (const line of lines[name] ?? []) if (line.ts >= cutoff) n++;
    }
    return n;
  }, [lines, selected, tick]);

  const ansiPresent = useMemo(
    () => selected.some((name) => (lines[name] ?? []).some((l) => hasAnsi(l.text))),
    [lines, selected],
  );

  const toggleContainer = useCallback((name: string) => {
    setUnknownRequested([]);
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= MAX_TRACKS) return prev;
      return [...prev, name];
    });
  }, []);

  const toggleLevel = useCallback((level: LogLevel) => {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);

  const toggleCollapse = useCallback((name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const dense = selected.length > 3;
  const allLevelsOff = levels.size === 0;

  // The honest way to say "how much history is here" is the span the archive
  // actually covers, not a figure derived from the cap and this host's average
  // rate — a quiet night and a container restart storm fill it very differently.
  const archiveSpan =
    archive.stats.oldestTs !== null && archive.stats.newestTs !== null
      ? formatUptime((archive.stats.newestTs - archive.stats.oldestTs) / 1000)
      : null;
  // Say it out loud before the reader notices lines vanishing from the top.
  const archiveNearCap = archive.stats.count >= ARCHIVE_LINE_CAP * 0.9;

  // A `?c=` name that no longer matches a container gets dropped — but dropping
  // it in silence lands the reader on an empty floor with no reason given, so a
  // stale bookmark reads as a broken page rather than a stale one.
  // State, not a memo over the prop: `initialSelection` never changes, so a
  // derived value would leave a stale-bookmark warning on screen for the whole
  // session — an hour and three container changes later, still complaining about
  // a link the reader has long since moved on from. Cleared on the first
  // selection change, which is the moment it stops being the answer to
  // "why is the floor empty?".
  const [unknownRequested, setUnknownRequested] = useState<string[]>(() =>
    initialSelection.filter((n) => !known.has(n)),
  );

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Logs</h1>
          <p className="text-xs text-ink-dim mt-0.5">
            {selected.length === 0 ? (
              <>
                {containers.length} containers on the box · pick the ones worth watching
              </>
            ) : (
              <>
                <span className="font-mono text-ink">{selected.length}</span>
                {selected.length === 1 ? " track" : " tracks"} ·{" "}
                <span className="font-mono text-ink">{ratePerMin}</span> lines in the last
                minute
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {selected.length > 0 && <ConnectionPill connection={connection} />}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected([])}
              className="inline-flex items-center min-h-11 md:min-h-0 px-1 text-xs text-ink-faint hover:text-ink transition-colors cursor-pointer"
            >
              clear floor
            </button>
          )}
        </div>
      </header>

      {unknownRequested.length > 0 && (
        <p className="text-[0.7rem] text-warn">
          <span className="font-mono">{unknownRequested.join(", ")}</span>{" "}
          {unknownRequested.length === 1 ? "is not a container" : "are not containers"} on this
          box any more — nothing was put on the floor for{" "}
          {unknownRequested.length === 1 ? "it" : "them"}.
        </p>
      )}

      <ContainerRail
        containers={containers}
        selected={selected}
        onToggle={toggleContainer}
        max={MAX_TRACKS}
        pulse={arrivals}
      />

      {/* Toolbar. Sticks on desktop only: with six tracks the page scrolls past
          it, and a filter you have to scroll back up to reach stops being a live
          filter. On mobile the app already owns the top edge with its own bar. */}
      <div className="md:sticky md:top-0 md:z-30 md:-mx-4 md:px-4 md:py-2 md:bg-bg/90 md:backdrop-blur">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[12rem]">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
            />
            <input
              ref={filterRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="regex filter — case-insensitive"
              aria-label="Filter log lines by regular expression"
              aria-invalid={patternBroken}
              // aria-invalid with nothing associated announces "invalid" and no
              // reason; the message below carries the reason, so point at it.
              aria-describedby={patternBroken ? "log-filter-error" : undefined}
              className={cn(
                "h-11 md:h-9 w-full rounded-md bg-panel-2 border pl-8 pr-16 font-mono text-xs placeholder:text-ink-faint focus:outline-none transition-colors",
                patternBroken
                  ? "border-warn/60 focus:border-warn"
                  : "border-line focus:border-accent/50",
              )}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear filter"
                  className="inline-flex items-center justify-center h-11 w-11 md:h-6 md:w-6 text-ink-faint hover:text-ink cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
              {!query && (
                <kbd className="hidden sm:block font-mono text-[0.6rem] text-ink-faint border border-line rounded px-1 py-px">
                  /
                </kbd>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {LEVEL_ORDER.map((level) => (
              <SegmentButton
                key={level}
                active={levels.has(level)}
                onClick={() => toggleLevel(level)}
                // The code leads so the accessible name contains the pill's own
                // visible text — "debug lines" alone would name a control the
                // reader sees as "DBG".
                label={`${LEVEL_CODE[level]} — ${LEVEL_LABEL[level]} lines`}
              >
                <span className="font-mono">{LEVEL_CODE[level]}</span>
                {level === "none" && <span className="ml-1 hidden sm:inline">no level</span>}
                <span className="ml-1.5 font-mono text-[0.65rem] text-ink-faint tabular-nums">
                  {levelCounts[level]}
                </span>
              </SegmentButton>
            ))}
          </div>

          <SegmentButton
            active={ansi}
            onClick={() => setAnsi((v) => !v)}
            label="Replay the container's own ANSI colour"
          >
            <Baseline size={12} className="inline -mt-px mr-1" />
            ANSI
          </SegmentButton>
        </div>

        {patternBroken && (
          <p id="log-filter-error" className="mt-1.5 text-[0.7rem] text-warn">
            <span className="font-mono">{query}</span> is not a complete pattern yet — no
            filter applied.
          </p>
        )}
        {!patternBroken && !ansiPresent && ansi && selected.length > 0 && (
          <p className="mt-1.5 text-[0.7rem] text-ink-faint">
            Nothing on the floor has emitted colour — ANSI has nothing to replay here.
          </p>
        )}
        {allLevelsOff && (
          <p className="mt-1.5 text-[0.7rem] text-warn">
            Every level is switched off, so no line can match.{" "}
            <button
              type="button"
              onClick={() => setLevels(new Set(LEVEL_ORDER))}
              className="inline-flex items-center min-h-11 md:min-h-0 underline underline-offset-2 hover:text-ink cursor-pointer"
            >
              switch them all back on
            </button>
          </p>
        )}
        {connection === "unauthorized" && (
          <p className="mt-1.5 text-[0.7rem] text-bad">
            Your session expired and the stream stopped.{" "}
            <a href="/logs" className="underline underline-offset-2 hover:text-ink">
              Reload to sign in again
            </a>{" "}
            — the tracks below are the last lines that arrived, not live.
            {archive.stats.count > 0 && " Archived lines are still readable on every track."}
          </p>
        )}

        {/* Storage disclosure, in the same advisory register as the notes above
            it. Container logs on this box carry real credentials, so the fact
            that they are now written to this device is stated plainly and the
            way to undo it sits next to the statement, not in Settings. */}
        {archive.available && archive.stats.count > 0 && (
          // ink-dim, not the ink-faint the sibling notes use: measured at 11px
          // ink-faint is 3.1:1 against this ground, and this is the one line in
          // the group that both discloses what is being written to the device
          // and carries a destructive control. Those have to be readable.
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-ink-dim">
            <Database size={11} className="shrink-0" aria-hidden />
            {confirmPurge ? (
              <>
                {/* The count lives on the button, not in the question: repeating
                    it in both is the redundancy clarify warns about, and the
                    number matters most where the click happens. */}
                <span className="text-ink">Delete every archived line? This can&apos;t be undone.</span>
                {/* One flex item, so the two answers never split across a wrap
                    and strand "Keep it" on a line of its own with no question
                    attached to it — which is exactly what 390px did. */}
                <span className="inline-flex items-center gap-2">
                  {/* Safe answer first, and deliberately in the slot the
                      trigger occupied: with "Delete archive" in both places, a
                      second click in the same spot destroyed 387 lines without
                      the prompt ever being read. */}
                  <button
                    type="button"
                    onClick={() => setConfirmPurge(false)}
                    className="inline-flex items-center min-h-11 md:min-h-0 px-1 hover:text-ink cursor-pointer"
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void archive.clear();
                      setConfirmPurge(false);
                    }}
                    disabled={archive.clearing}
                    className="inline-flex items-center min-h-11 md:min-h-0 px-1 text-bad underline underline-offset-2 hover:text-ink cursor-pointer disabled:opacity-60"
                  >
                    Delete {formatNumber(archive.stats.count)} lines
                  </button>
                </span>
              </>
            ) : (
              <>
                <span>
                  <span className="font-mono text-ink tabular-nums">
                    {formatNumber(archive.stats.count)}
                  </span>{" "}
                  lines kept on this device
                  {archiveSpan && (
                    <>
                      {" · "}
                      <span className="font-mono tabular-nums">{archiveSpan}</span>
                    </>
                  )}
                  {" · "}
                  <span className="font-mono tabular-nums">{formatBytes(archive.stats.bytes)}</span>
                  {archiveNearCap && " · oldest are being evicted"}
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmPurge(true)}
                  className="inline-flex items-center min-h-11 md:min-h-0 px-1 underline underline-offset-2 hover:text-ink cursor-pointer"
                >
                  Delete archive
                </button>
              </>
            )}
          </p>
        )}
      </div>

      {selected.length === 0 ? (
        <EmptyFloor />
      ) : (
        <div className="space-y-3">
          {selected.map((name) => (
            <LogTrack
              key={name}
              container={name}
              state={tracks[name]}
              lines={lines[name] ?? []}
              levels={levels}
              highlight={highlight}
              query={query}
              ansi={ansi}
              collapsed={collapsed.has(name)}
              onToggleCollapse={() => toggleCollapse(name)}
              onRemove={() => toggleContainer(name)}
              dense={dense}
              short={short[name]}
              seedCount={seedCount[name]}
              // Key presence, not line count: a container with no scrollback at
              // all still gets a seed event, and that is the one whose first live
              // line most deserves to be seen arriving.
              seeded={name in seedCount}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectionPill({ connection }: { connection: LogConnection }) {
  const map = {
    idle: { text: "idle", cls: "text-ink-faint", dot: "dot-stopped" },
    connecting: { text: "connecting", cls: "text-ink-dim", dot: "dot-restarting" },
    live: { text: "streaming", cls: "text-ink-dim", dot: "dot-running" },
    lost: { text: "reconnecting", cls: "text-warn", dot: "dot-unhealthy" },
    // EventSource cannot see a 401 and retries forever, so without this the pill
    // would sit on "reconnecting" while the truth is that the reader is signed out.
    unauthorized: { text: "signed out", cls: "text-bad", dot: "dot-dead" },
  } as const;
  const s = map[connection];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", s.cls)}>
      <span className={cn("dot", s.dot)} />
      {s.text}
    </span>
  );
}

/**
 * The floor before anything is on it. This is the state a first visit lands in,
 * so it teaches the one gesture the page has rather than apologising for being
 * empty — and it says out loud that a quiet track is the normal reading here,
 * because on this box it is.
 */
function EmptyFloor() {
  return (
    <div className="panel px-5 py-8 text-center">
      <p className="text-sm text-ink">The floor is empty.</p>
      <p className="text-xs text-ink-dim mt-1.5 max-w-md mx-auto">
        Take a container off the rail above and its log lands here, last {LOG_TAIL_DEFAULT}{" "}
        lines first, then live. Up to {MAX_TRACKS} at once, each in its own band.
      </p>
      <p className="text-[0.7rem] text-ink-dim mt-3 max-w-md mx-auto">
        This box is quiet — a few lines a minute across everything. A track that sits
        still is working, not broken.
      </p>
    </div>
  );
}

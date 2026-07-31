"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { LogLine, LogSeedEvent, LogTrackState } from "@/lib/log-types";
import { LOG_BUFFER_CAP, LOG_TAIL_DEFAULT } from "@/lib/log-types";

export type LogConnection = "idle" | "connecting" | "live" | "lost" | "unauthorized";

/**
 * Consecutive `onerror` events tolerated before probing whether the session
 * itself has expired. `EventSource` retries transient network blips on its
 * own and fires `open` again when they clear, so this is deliberately not 1
 * — the probe only fires once loss starts to look like something more
 * permanent than a blip.
 */
const UNAUTHORIZED_PROBE_THRESHOLD = 3;

export interface LogStreamResult {
  /** Per-container ring buffers, oldest first, capped at LOG_BUFFER_CAP. */
  lines: Record<string, LogLine[]>;
  tracks: Record<string, LogTrackState>;
  connection: LogConnection;
  /**
   * Per-container count of lines delivered by the `line` SSE event so far
   * this session — a monotonic counter, NOT a timestamp. `seed` events never
   * increment it, so a container just added to the floor reads 0 (or is
   * absent) until something genuinely arrives live, rather than "flashing"
   * for scrollback that may be hours old.
   *
   * It's a counter rather than a timestamp specifically so a consumer can
   * key a one-shot animation off it (e.g. `key={arrivals[name]}`) and get
   * exactly one replay per line — including two lines landing in the same
   * millisecond, a real burst pattern on this host (stack traces, Postgres
   * `DETAIL:` runs) that a timestamp-keyed remount would silently collapse
   * into a single flash.
   */
  arrivals: Record<string, number>;
  /**
   * Per-container `short` flag from its `seed` event: true when the
   * container had fewer lines than the requested tail, i.e. the seeded
   * scrollback IS its entire history, not a truncated window into more.
   * Worth surfacing on a host this quiet (~17 lines/min across the fleet) —
   * "you're looking at everything this container has ever logged" is a
   * real, useful answer, not an edge case.
   *
   * Set once from `seed` and then left alone: it describes the seeded
   * history at connect time, not the live stream, so a `line` event must
   * NEVER touch it. A container seeded with 37 lines (fewer than the tail,
   * so `short: true`) that later receives live lines still HAD only 37 lines
   * of history when it joined — that fact doesn't become false just because
   * something new arrived. Resist "fixing" this to flip false on first
   * arrival; that would answer a different question than the one this field
   * exists to answer.
   */
  short: Record<string, boolean>;
  /**
   * How many lines the `seed` event carried, per container. Two jobs, both of
   * which the live buffer cannot do:
   *
   * 1. It is the number to quote when saying "only N lines exist" — `lines.length`
   *    grows with every live arrival, so a container seeded with 37 would soon be
   *    claiming 42, contradicting the `short` flag beside it.
   * 2. Its PRESENCE (`name in seedCount`) is how a consumer knows the seed has
   *    landed, distinct from "the buffer is non-empty". A container with no
   *    scrollback at all seeds with zero lines, and without this a consumer
   *    cannot tell that case from "nothing has arrived yet" — which is exactly
   *    the container whose first live line matters most.
   */
  seedCount: Record<string, number>;
}

/** Mutable backing store for the hook. Lives in a ref (not state) because
 * lines/tracks/arrivals/short are written far more often than the console
 * needs to re-render — re-renders are driven separately, coalesced via rAF
 * below. */
interface LogStore {
  lines: Record<string, LogLine[]>;
  tracks: Record<string, LogTrackState>;
  arrivals: Record<string, number>;
  short: Record<string, boolean>;
  seedCount: Record<string, number>;
}

function sortedKey(selection: string[]): string {
  return [...selection].sort().join(",");
}

/**
 * Subscribes to the multiplexed container log SSE stream and accumulates
 * per-container ring buffers client-side.
 *
 * The hard problem here isn't volume (the host emits ~17 lines/min across 26
 * containers — a firehose this is not) but that `selection` changes over the
 * session and buffers for containers that stay selected must survive that
 * change untouched, so switching tabs back and forth doesn't re-fetch or
 * duplicate scrollback that's already in memory.
 */
export function useLogStream(selection: string[]): LogStreamResult {
  const storeRef = useRef<LogStore>({
    lines: {},
    tracks: {},
    arrivals: {},
    short: {},
    seedCount: {},
  });
  const connectionRef = useRef<LogConnection>("idle");
  const frameRef = useRef<number | null>(null);
  const [version, bumpVersion] = useReducer((v: number) => v + 1, 0);

  const cancelPendingFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  // A burst of ~200 lines on a container restart would otherwise cause ~200
  // renders; coalescing every store mutation through one rAF collapses that
  // to one render per frame, however many events landed in it.
  const scheduleRender = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      bumpVersion();
    });
  }, []);

  const key = useMemo(() => sortedKey(selection), [selection]);

  useEffect(() => {
    const containers = key === "" ? [] : key.split(",");

    if (containers.length === 0) {
      connectionRef.current = "idle";
      scheduleRender();
      return cancelPendingFrame;
    }

    // Drop buffers for containers that fell out of the selection; buffers for
    // containers that are STILL selected are left untouched below.
    const selected = new Set(containers);
    for (const name of Object.keys(storeRef.current.lines)) {
      if (!selected.has(name)) {
        delete storeRef.current.lines[name];
        delete storeRef.current.tracks[name];
        delete storeRef.current.arrivals[name];
        delete storeRef.current.short[name];
        delete storeRef.current.seedCount[name];
      }
    }

    // Only containers with no buffer yet need seeding — re-seeding an already
    // buffered container would duplicate its scrollback on every selection change.
    const seed = containers.filter((c) => !(c in storeRef.current.lines));

    connectionRef.current = "connecting";
    scheduleRender();

    const params = new URLSearchParams();
    params.set("c", containers.join(","));
    if (seed.length > 0) params.set("seed", seed.join(","));
    params.set("tail", String(LOG_TAIL_DEFAULT));

    const es = new EventSource(`/api/logs/stream?${params.toString()}`);

    // `EventSource` cannot see HTTP status codes — a 401 from an expired
    // session and a transient network blip both surface only as `onerror`,
    // and the browser retries either one forever. Left alone, an expired
    // session shows "reconnecting" indefinitely while the truth is the
    // reader is logged out. `errorStreak` counts consecutive failures (reset
    // on a successful `open`); past the threshold, `probeSession` makes one
    // authenticated request to tell the two cases apart. Once that probe
    // confirms a 401, `probeConfirmedUnauthorized` latches so the state
    // doesn't flicker back to "lost" on every subsequent retry.
    let cancelled = false;
    let errorStreak = 0;
    let probeConfirmedUnauthorized = false;

    async function probeSession() {
      try {
        const res = await fetch("/api/host", { credentials: "same-origin" });
        if (cancelled) return;
        if (res.status === 401) {
          probeConfirmedUnauthorized = true;
          connectionRef.current = "unauthorized";
          scheduleRender();
        }
      } catch {
        // The probe itself failed (offline, etc.) — inconclusive. The next
        // error streak will try again.
      }
    }

    es.addEventListener("open", () => {
      errorStreak = 0;
      connectionRef.current = "live";
      scheduleRender();
    });

    es.addEventListener("seed", (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as LogSeedEvent;
        storeRef.current.lines[parsed.container] = parsed.lines;
        storeRef.current.short[parsed.container] = parsed.short;
        storeRef.current.seedCount[parsed.container] = parsed.lines.length;
        // Deliberately NOT touching arrivals here — seeded scrollback is not a
        // live arrival, however recent it looks. See the LogStreamResult doc
        // comment on `arrivals` for why.
        scheduleRender();
      } catch {
        // Malformed event: drop it rather than crash the hook.
      }
    });

    es.addEventListener("line", (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as LogLine;
        const existing = storeRef.current.lines[parsed.container] ?? [];
        const next = [...existing, parsed];
        storeRef.current.lines[parsed.container] =
          next.length > LOG_BUFFER_CAP ? next.slice(next.length - LOG_BUFFER_CAP) : next;
        storeRef.current.arrivals[parsed.container] =
          (storeRef.current.arrivals[parsed.container] ?? 0) + 1;
        scheduleRender();
      } catch {
        // Malformed event: drop it rather than crash the hook.
      }
    });

    es.addEventListener("state", (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as LogTrackState;
        storeRef.current.tracks[parsed.container] = parsed;
        scheduleRender();
      } catch {
        // Malformed event: drop it rather than crash the hook.
      }
    });

    // Transient network errors: EventSource auto-reconnects on its own and will
    // fire "open" again, so just surface "lost" via status — don't close the
    // connection or reject via next(), and keep existing samples so the UI can
    // dim stale data instead of blanking. (Mirrors useTelemetryStream's onerror.)
    es.onerror = () => {
      if (cancelled) return;
      if (!probeConfirmedUnauthorized) {
        connectionRef.current = "lost";
        scheduleRender();
        errorStreak += 1;
        if (errorStreak >= UNAUTHORIZED_PROBE_THRESHOLD) {
          errorStreak = 0;
          void probeSession();
        }
      }
    };

    return () => {
      cancelled = true;
      es.close();
      cancelPendingFrame();
    };
    // Reconnecting on a selection change loses at most a few hundred ms of
    // lines (whatever arrives between the old EventSource closing and the new
    // one's seed) — acceptable at ~17 lines/min across the fleet, so there's
    // no gap-recovery/resume-cursor logic here.
  }, [key, scheduleRender, cancelPendingFrame]);

  return useMemo<LogStreamResult>(
    () => ({
      lines: { ...storeRef.current.lines },
      tracks: { ...storeRef.current.tracks },
      arrivals: { ...storeRef.current.arrivals },
      short: { ...storeRef.current.short },
      seedCount: { ...storeRef.current.seedCount },
      connection: connectionRef.current,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the render trigger; store/connection are refs.
    [version],
  );
}

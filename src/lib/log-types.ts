/**
 * Log console contract — the shape of one line and one track.
 *
 * Import-free on purpose: this module is reachable from `"use client"` code and
 * from the server-side follow-stream registry, so it must pull in neither.
 *
 * The measurement that shaped everything here: this host emits roughly 17 log
 * lines PER MINUTE across all 26 containers. The console's hard problem is not
 * volume, it is that arrivals are rare — so nothing in this contract optimises
 * for a firehose, and the states that matter are "connected but quiet" and
 * "this container never says what level it is".
 */

/**
 * Canonical level, collapsed from the 16 distinct level-token formats actually
 * present on this box (Servarr `[Info]`, uvicorn `INFO:`, logfmt `level=warn`,
 * Postgres `LOG:`, Jellyfin `[INF]`, NestJS padded `LOG`, Redis `*`, …).
 *
 * `none` is a real value, not a fallback for laziness: five containers here
 * (homelab-dashboard, its haproxy, homepage, qbittorrent, jellystat) never emit
 * a level in any line. A level filter that silently drops `none` would render
 * those containers permanently empty and lie about why, so `none` is filterable
 * only by its own explicit control.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "none";

/** Which of docker's two multiplexed frame types the line arrived on. */
export type LogStream = "stdout" | "stderr";

export interface LogLine {
  /** `${container}:${monotonic seq}` — assigned server-side, stable as a React key. */
  id: string;
  /** Container NAME, not id: the rail, the URL and the gutter all speak names. */
  container: string;
  /**
   * Epoch ms, parsed from docker's own RFC3339Nano prefix. This is the only
   * timestamp on this host that is uniform across all 26 containers, so it is
   * the one the gutter shows and the one lines sort by.
   */
  ts: number;
  stream: LogStream;
  level: LogLevel;
  /**
   * The message body, verbatim, with docker's timestamp prefix stripped and
   * **ANSI escape sequences left intact**.
   *
   * Two deliberate consequences. First, 14 containers print their own timestamp
   * inside the body in 14 different formats; those stay, because stripping them
   * would mean guessing at 14 parsers to save one column. Second, ANSI survives
   * transport so the console's ANSI control is a render-time decision — unlike
   * `containerLogs()` in docker.ts, which strips at read time and can never get
   * the colour back.
   */
  text: string;
}

/**
 * A track's connection state. `ended` is not an error: `docker logs --follow`
 * on a stopped container closes immediately and correctly, and the track keeps
 * its scrollback afterwards.
 *
 * `lost` is deliberately never emitted per track. Every container shares ONE
 * multiplexed SSE connection, so transport loss is not a property a single track
 * can have — it is reported once, globally, by the console's connection pill.
 * The member stays because a track renders it if it ever arrives; do not invent a
 * per-track signal for it, because the transport genuinely does not have one.
 */
export type LogTrackStatus = "connecting" | "live" | "ended" | "error" | "lost";

export interface LogTrackState {
  container: string;
  status: LogTrackStatus;
  /** Cause in the product's own words, shown on the track. Null while healthy. */
  detail: string | null;
}

/** One container's scrollback, delivered once when it joins the stream. */
export interface LogSeedEvent {
  container: string;
  lines: LogLine[];
  /** True when the container had fewer lines than the requested tail. */
  short: boolean;
}

export const LOG_TAIL_DEFAULT = 200;

/**
 * The window every rate readout on this surface measures over — the page
 * headline's "N lines in the last minute" and each track's "N/min".
 *
 * Lives here rather than in either component because both quote it in their own
 * copy: two components claiming "the last minute" from two different constants
 * is a caption that can silently stop being true.
 */
export const RATE_WINDOW_MS = 60_000;

/**
 * How often anything on this surface that quotes elapsed time re-renders: the
 * rate readouts and the "last line 14m ago" age. One constant because it is one
 * decision — how coarsely the console admits that time is passing — and two
 * local copies of 10_000 in two components is how that decision quietly becomes
 * two different decisions.
 */
export const CLOCK_TICK_MS = 10_000;

/**
 * Per-track ring capacity. 2000 lines at this host's worst-case line length
 * (549 chars, immich_postgres) is about half a megabyte per track — affordable
 * for six tracks, and far past what 17 lines/min can fill in a sitting.
 */
export const LOG_BUFFER_CAP = 2000;

/**
 * Soft ceiling on simultaneous tracks. Not a connection limit — the console
 * multiplexes every container onto one SSE stream. It is a scanability limit:
 * four full-width tracks fit a 1080p viewport, and past six the rail stops
 * being readable at a glance, which is the whole point of the rail.
 */
export const MAX_TRACKS = 6;

/** Pill order in the toolbar: quietest to loudest, then the honest outlier. */
export const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error", "none"];

/** Gutter codes. Fixed width so the message column never shifts between lines. */
export const LEVEL_CODE: Record<LogLevel, string> = {
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
  none: "—",
};

export const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  none: "no level",
};

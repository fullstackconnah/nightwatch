// From the import-free leaf, NOT from `@/components/ansi`: that module is
// `"use client"`, and this file runs on the server via log-stream.ts, where
// calling a client export throws at runtime. tsc and the webpack build both pass
// anyway — the symptom was every scrollback seed failing against a live host.
import { stripAnsi } from "@/lib/ansi-escapes";
import type { LogLevel } from "@/lib/log-types";

/**
 * Classifies a log line's severity from its own text, container-agnostic.
 *
 * Measured against 16 distinct level-token formats actually seen on this host
 * (see comments on each rule below for which container it was taken from).
 * Five containers here never emit a level in any line — "none" is the correct,
 * common answer for those, not a bug in this file.
 *
 * `text` is the message body with docker's own timestamp prefix already
 * stripped (see log-stream.ts) but each container's OWN in-body timestamp,
 * if any, is still present — several of the rules below match through it.
 * ANSI escapes may still be present; this function strips them internally for
 * matching only, and never mutates the caller's string.
 */
export function classifyLevel(text: string): LogLevel {
  const clean = stripAnsi(text);

  for (const rule of RULES) {
    const match = clean.match(rule.pattern);
    if (!match) continue;
    const token = match[1];
    const level = rule.resolve ? rule.resolve(token) : CANONICAL[token.toUpperCase()];
    if (level) return level;
  }

  return "none";
}

/** TRACE/VERBOSE/DEBUG/DBG/TRC -> debug; INFO/INF/LOG/NOTICE -> info; WARN/WARNING/WRN -> warn; ERROR/ERR/FATAL/FTL/CRITICAL/PANIC/SEVERE -> error. */
const CANONICAL: Record<string, LogLevel | undefined> = {
  TRACE: "debug",
  VERBOSE: "debug",
  DEBUG: "debug",
  DBG: "debug",
  TRC: "debug",
  INFO: "info",
  INF: "info",
  LOG: "info",
  NOTICE: "info",
  WARN: "warn",
  WARNING: "warn",
  WRN: "warn",
  ERROR: "error",
  ERR: "error",
  FATAL: "error",
  FTL: "error",
  CRITICAL: "error",
  PANIC: "error",
  SEVERE: "error",
};

interface Rule {
  pattern: RegExp;
  /** Override canonical lookup, e.g. Postgres continuation keywords or Redis's single-char codes. */
  resolve?: (token: string) => LogLevel | undefined;
}

const POSTGRES_RESOLVE = (token: string): LogLevel | undefined => {
  switch (token) {
    case "LOG":
      return "info";
    case "WARNING":
      return "warn";
    case "FATAL":
    case "PANIC":
    case "ERROR":
      return "error";
    // DETAIL/HINT/STATEMENT are continuation context for the preceding line, not
    // their own severity.
    case "DETAIL":
    case "HINT":
    case "STATEMENT":
      return "none";
    default:
      return undefined;
  }
};

const REDIS_RESOLVE = (token: string): LogLevel | undefined => {
  switch (token) {
    case ".":
      return "debug";
    case "-":
    case "*":
      return "info";
    case "#":
      return "warn";
    default:
      return undefined;
  }
};

// Ordered most-specific-structure first so a broad/bare rule near the end can't
// steal a match that a narrower, better-anchored rule further up already owns.
const RULES: Rule[] = [
  // Postgres (immich_postgres, jellystat-db): `2026-07-30 11:33:35.095 UTC [26] LOG:  checkpoint starting: time`
  {
    pattern: /^\S+\s+\S+\s+\S+\s+\[\d+\]\s+(LOG|FATAL|PANIC|ERROR|WARNING|DETAIL|HINT|STATEMENT):/,
    resolve: POSTGRES_RESOLVE,
  },
  // pihole: `2026-07-30 12:48:26.938 AEST [52/T60] INFO: Web server ports:`
  {
    pattern: /^\S+\s+\S+\s+\S+\s+\[\d+\/T\d+\]\s+(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL):/,
  },
  // Redis (immich_redis): `1:M 30 Jul 2026 11:59:19.001 * Background saving started` — lone
  // `.`/`-`/`*`/`#` token surrounded by spaces right after redis's own timestamp, so free
  // prose containing an asterisk elsewhere in the line is never misread.
  {
    pattern: /^\d+:[A-Za-z]\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\.\d+\s+([.\-*#])\s/,
    resolve: REDIS_RESOLVE,
  },
  // NestJS (immich_server): `[Nest] 7  - 07/30/2026, 6:56:00 PM     LOG [Microservices:VersionService] …`
  // padded LOG|ERROR|WARN|DEBUG|VERBOSE|FATAL. NestJS LOG -> info, VERBOSE -> debug (both via CANONICAL).
  //
  // The middle is `.*?` and NOT `.*?\]`: there is no closing bracket between
  // `[Nest]` and the level — the next `]` belongs to the `[Context]` that comes
  // AFTER it. Requiring one classified all 200 of immich_server's seeded lines
  // as "none" against a live host, which is how the bug was found.
  {
    pattern: /^\[Nest\]\s+\d+\s+-\s+.*?\s(LOG|ERROR|WARN|DEBUG|VERBOSE|FATAL)\s+\[/,
  },
  // Home Assistant: `2026-07-30 12:48:33.993 WARNING (zeroconf-…) [pychromecast.dial] Failed…`
  {
    pattern: /^\d{4}-\d{2}-\d{2}\s+[\d:.]+\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+\(/,
  },
  // Jellyfin: `[21:35:46] [INF] [37] Component: message`
  {
    pattern: /^\[\d{2}:\d{2}:\d{2}\]\s+\[(TRC|DBG|INF|WRN|ERR|FTL)\]/,
  },
  // Servarr (prowlarr/sonarr/radarr/bazarr): `[Info] ReleaseSearchService: Searching…`
  {
    pattern: /^\[(Trace|Debug|Info|Warn|Error|Fatal)\]/i,
  },
  // pigallery2: `7/30/2026, 3:07:31 AM[INFO_][JobManager] Running job schedules` — note the
  // trailing underscore inside the bracket.
  {
    pattern: /\[(DEBUG|INFO|WARN|ERROR)_\]/,
  },
  // dockge: `2026-04-17T06:24:05Z [SERVER] INFO: message`
  {
    pattern: /\[SERVER\]\s+(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL):/,
  },
  // uvicorn (vaultview, glances): `INFO:     192.168.1.47:34734 - "GET /api/audit HTTP/1.1" 200 OK`
  {
    pattern: /^(CRITICAL|ERROR|WARNING|INFO|DEBUG|TRACE):/,
  },
  // seerr: `2026-07-30T12:00:00.013Z [info][Jellyfin Sync]: Scan starting {…}` — lowercase bracketed.
  {
    pattern: /^\S+\s+\[(debug|info|warn|error)\]/i,
  },
  // gluetun: `2026-07-30T12:48:35+10:00 INFO [port forwarding] port forwarded is 63995`
  {
    pattern: /^\S+\s+(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\s+\[/,
  },
  // cloudflared: `2026-07-30T05:45:23Z INF Tunnel connection… connIndex=3`
  {
    pattern: /^\S+\s+(TRC|DBG|INF|WRN|ERR|FTL)\b/,
  },
  // nginx-proxy-manager: `[SSL      ] › ℹ  info      Renewing SSL certs…` — unicode symbols
  // (ℹ ⚠ ✖ ⬤) may precede the word after the `›`.
  {
    pattern: /›\s*(?:[^\w\s]\s*)?(info|warning|error|debug)\b/i,
  },
  // logfmt (watchtower): `time="…" level=warning msg="…"`
  {
    pattern: /\blevel=(\w+)/i,
  },
  // immich_machine_learning (Rich), sub-format 2: `[INFO] 2026-07-30 04:54:54,016 [RapidOCR] base.py:22: …`
  {
    pattern: /^\[(DEBUG|INFO|WARNING|ERROR|CRITICAL)\]\s+\d{4}-\d{2}-\d{2}/,
  },
  // immich_machine_learning (Rich), sub-format 1: a bare, space-padded level token at the
  // very start of the line (Rich right-pads the word to an 8-char column). Kept last —
  // broadest/least-anchored rule, so every more specific structured format above gets a
  // chance to claim the line first.
  {
    pattern: /^(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s{1,4}\S/,
  },
];

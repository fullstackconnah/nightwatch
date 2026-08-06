/**
 * Kiosk download-tray payload. Deliberately a NARROWER, separate shape from
 * the settings-page `qbittorrent` widget fetcher's WidgetField[] (see
 * builtins.ts) — this one feeds the public, unauthenticated /kiosk route, so
 * it carries only what a wall tablet needs to draw a progress bar and never
 * the configured server URL or credentials. Lives in its own module so both
 * the server route and the client component can import it without either
 * pulling in the other's dependencies (fs-touching config on one side,
 * "use client" React on the other).
 */
export interface KioskDownloadItem {
  hash: string;
  name: string;
  /** 0-1, qBittorrent's own convention. */
  progress: number;
  /** Bytes/sec. Always > 0 here — zero-speed torrents are filtered out
   *  server-side before this shape is ever built (see getKioskDownloads in
   *  builtins.ts), per the owner's "ignore torrents with zero download
   *  speed" rule. */
  dlspeed: number;
  /** Total size in bytes. */
  size: number;
  /** Seconds remaining, or null when qBittorrent reports its own "infinity"
   *  sentinel (8640000) — i.e. no meaningful estimate yet. */
  eta: number | null;
}

export type KioskDownloadsResult =
  | { status: "unconfigured" }
  | { status: "unreachable" }
  | { status: "ok"; items: KioskDownloadItem[] };

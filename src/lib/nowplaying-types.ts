/**
 * Normalized "now playing" shape shared by /kiosk/api/nowplaying/route.ts and
 * its client hook (useKioskNowPlaying in src/lib/kiosk-client.ts). Import-free
 * leaf, same bundle-boundary reason as transcode-types.ts: a "use client"
 * component that value-imports a server module (ha.ts, jellyfin.ts) drags
 * node:fs-adjacent code into the browser bundle, and `tsc --noEmit` stays
 * quiet about it while only `next build` would fail.
 *
 * Both HA media_player and Jellyfin sessions get flattened into this one
 * shape before they ever reach the client — the pill has no idea which
 * source it's rendering beyond the `source` tag itself.
 */

export type NowPlayingSource = "ha" | "jellyfin";
export type NowPlayingState = "playing" | "paused";

export interface NowPlayingActive {
  status: "ok";
  source: NowPlayingSource;
  title: string;
  /** Episode's series name, when the source reports one. */
  subtitle?: string;
  /** HA's app_name ("YouTube", "Plex", ...) or "Jellyfin" — plain text only,
   *  never a URL (see the route's own sanitize comment). */
  appName?: string;
  state: NowPlayingState;
  /** 0-1, when the source reports both a position and a duration. */
  progress01?: number;
}

/** Nothing playing on either source, or neither source configured — the pill
 *  treats both the same way: it just doesn't render (see the route's own
 *  comment for why "unconfigured" never gets its own status here). */
export interface NowPlayingIdle {
  status: "idle";
}

export type NowPlayingSnapshot = NowPlayingActive | NowPlayingIdle;

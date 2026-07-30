/**
 * Jellyfin transcode-session shapes. Import-free leaf for the same bundle-boundary
 * reason as gpu-types.ts — see the note there.
 */

export type TranscodeUnavailableReason =
  /** No Jellyfin API key in data/config.json. The reader has to add one. */
  | "not-configured"
  /** Jellyfin did not answer (down, wrong URL, timeout). */
  | "unreachable"
  /** Jellyfin answered 401/403 — the key is wrong or revoked. */
  | "unauthorized"
  | "error";

export interface TranscodesUnavailable {
  ok: false;
  reason: TranscodeUnavailableReason;
  detail: string;
}

/** How Jellyfin is delivering this stream. */
export type PlayMethod = "DirectPlay" | "DirectStream" | "Transcode" | "unknown";

export interface TranscodeStream {
  /** Jellyfin session id — stable for the life of the session, used as React key. */
  id: string;
  /** Display title, already assembled: "Series · S01E02 — Episode" or a film name. */
  title: string;
  user: string | null;
  client: string | null;
  device: string | null;
  playMethod: PlayMethod;
  isVideoTranscode: boolean;
  isAudioTranscode: boolean;
  /**
   * True only when Jellyfin reports a hardware encoder for this stream. A video
   * transcode with this false is a silent CPU fallback — the single most useful
   * fact on the surface, so it is never inferred from GPU state, only reported.
   */
  hardwareAccel: boolean;
  /** Jellyfin's own word for the accelerator, e.g. "nvenc". null when software. */
  hardwareAccelType: string | null;
  videoFrom: string | null;
  videoTo: string | null;
  audioFrom: string | null;
  audioTo: string | null;
  width: number | null;
  height: number | null;
  /** Target bitrate in bits per second. */
  bitrate: number | null;
  fps: number | null;
  /** Transcode progress 0-100, when Jellyfin reports it. */
  completionPct: number | null;
  /** Jellyfin's TranscodeReasons, e.g. ["VideoCodecNotSupported"]. */
  reasons: string[];
}

export interface TranscodesAvailable {
  ok: true;
  streams: TranscodeStream[];
}

export type TranscodeSnapshot = TranscodesAvailable | TranscodesUnavailable;

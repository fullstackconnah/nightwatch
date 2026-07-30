import { loadConfig } from "@/lib/config";
import type { PlayMethod, TranscodeSnapshot, TranscodeStream } from "@/lib/transcode-types";

/**
 * Server-only Jellyfin session fetcher. Credentials come from the top-level
 * `jellyfin` config block (see src/lib/config.ts), not widgets[]: an entry in
 * widgets[] feeds the widget fetcher (src/lib/widgets/index.ts), and a type
 * with no builtin falls through to the generic fetcher, which would GET
 * Jellyfin's web root and fail to parse the HTML as JSON. The base URL falls
 * back to `urls.jellyfin` (already used for the dashboard tile's open-app
 * link) when the `jellyfin` block doesn't set its own `url`.
 *
 * This does NOT go through src/lib/widgets/ — that pipeline returns flat
 * WidgetField rows for the overview grid, whereas transcode sessions need
 * their own richer shape (TranscodeSnapshot), so it's fetched directly here.
 */

const TIMEOUT_MS = 3000;

interface JellyfinCredentials {
  url: string;
  key: string;
}

function jellyfinCredentials(): JellyfinCredentials | null {
  const cfg = loadConfig();
  const key = cfg.jellyfin?.key?.trim();
  if (!key) return null;
  const url = cfg.jellyfin?.url || cfg.urls.jellyfin;
  if (!url) return null;
  return { url, key };
}

// --- Jellyfin /Sessions response shapes (minimal, only what we read) -------

interface JellyfinMediaStream {
  Type?: string;
  Codec?: string;
}

interface JellyfinNowPlayingItem {
  Name?: string;
  Type?: string;
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  MediaStreams?: JellyfinMediaStream[];
}

interface JellyfinTranscodingInfo {
  IsVideoDirect?: boolean;
  IsAudioDirect?: boolean;
  HardwareAccelerationType?: string | number;
  VideoCodec?: string;
  AudioCodec?: string;
  Width?: number;
  Height?: number;
  Bitrate?: number;
  Framerate?: number;
  CompletionPercentage?: number;
  TranscodeReasons?: string | string[];
}

interface JellyfinSession {
  Id: string;
  UserName?: string;
  Client?: string;
  DeviceName?: string;
  PlayState?: { PlayMethod?: string };
  NowPlayingItem?: JellyfinNowPlayingItem;
  TranscodingInfo?: JellyfinTranscodingInfo;
}

// --- mapping helpers ---------------------------------------------------------

/** Returns null (never NaN/undefined) for anything that isn't a finite number. */
function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const KNOWN_PLAY_METHODS: PlayMethod[] = ["DirectPlay", "DirectStream", "Transcode"];

function playMethodFrom(value: unknown): PlayMethod {
  return KNOWN_PLAY_METHODS.includes(value as PlayMethod) ? (value as PlayMethod) : "unknown";
}

/** "S02E05"-style code, omitting whichever half Jellyfin didn't send. */
function episodeCode(season?: number, episode?: number): string {
  const parts: string[] = [];
  if (typeof season === "number" && Number.isFinite(season)) parts.push(`S${String(season).padStart(2, "0")}`);
  if (typeof episode === "number" && Number.isFinite(episode)) parts.push(`E${String(episode).padStart(2, "0")}`);
  return parts.join("");
}

/**
 * "{SeriesName} · S01E02 — {Name}" for episodes, otherwise just the item name.
 * Every piece is optional in Jellyfin's response, so this joins only the parts
 * that exist instead of ever interpolating undefined into the string.
 */
function buildTitle(item: JellyfinNowPlayingItem): string {
  const name = typeof item.Name === "string" && item.Name ? item.Name : "Unknown";
  if (item.Type !== "Episode") return name;

  const series = typeof item.SeriesName === "string" && item.SeriesName ? item.SeriesName : null;
  const code = episodeCode(item.ParentIndexNumber, item.IndexNumber);

  const head = [series, code].filter(Boolean).join(" · ");
  return head ? `${head} — ${name}` : name;
}

/**
 * Jellyfin has shipped HardwareAccelerationType as both a string enum
 * ("none" | "nvenc" | "qsv" | ...) and, on some server versions, a numeric
 * enum where 0 means "none" — normalize both forms before deciding.
 */
function hardwareAccelFrom(raw: unknown): { active: boolean; type: string | null } {
  if (raw === undefined || raw === null) return { active: false, type: null };
  if (typeof raw === "number") {
    return raw === 0 ? { active: false, type: null } : { active: true, type: String(raw) };
  }
  const str = String(raw).trim();
  if (!str || str === "0" || str.toLowerCase() === "none") return { active: false, type: null };
  return { active: true, type: str.toLowerCase() };
}

/** TranscodeReasons arrives as either a comma-joined string or a string array. */
function reasonsFrom(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((r): r is string => typeof r === "string");
  if (typeof raw === "string" && raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function codecFor(streams: JellyfinMediaStream[] | undefined, type: string): string | null {
  return streams?.find((s) => s.Type === type)?.Codec ?? null;
}

function mapSession(session: JellyfinSession): TranscodeStream {
  const item = session.NowPlayingItem as JellyfinNowPlayingItem;
  const transcoding = session.TranscodingInfo;
  const hw = hardwareAccelFrom(transcoding?.HardwareAccelerationType);

  return {
    id: session.Id,
    title: buildTitle(item),
    user: session.UserName ?? null,
    client: session.Client ?? null,
    device: session.DeviceName ?? null,
    playMethod: playMethodFrom(session.PlayState?.PlayMethod),
    isVideoTranscode: transcoding?.IsVideoDirect === false,
    isAudioTranscode: transcoding?.IsAudioDirect === false,
    hardwareAccel: hw.active,
    hardwareAccelType: hw.type,
    videoFrom: codecFor(item.MediaStreams, "Video"),
    videoTo: transcoding?.VideoCodec ?? null,
    audioFrom: codecFor(item.MediaStreams, "Audio"),
    audioTo: transcoding?.AudioCodec ?? null,
    width: numberOrNull(transcoding?.Width),
    height: numberOrNull(transcoding?.Height),
    bitrate: numberOrNull(transcoding?.Bitrate),
    fps: numberOrNull(transcoding?.Framerate),
    completionPct: numberOrNull(transcoding?.CompletionPercentage),
    reasons: reasonsFrom(transcoding?.TranscodeReasons),
  };
}

function sortRank(s: TranscodeStream): number {
  if (s.isVideoTranscode) return 0;
  if (s.isAudioTranscode) return 1;
  return 2;
}

/**
 * Video transcodes first, then audio-only, then direct play: video transcodes
 * are the case most likely to be a silent CPU fallback, i.e. the failure this
 * widget exists to surface, so they sort to the top. Array#sort is stable in
 * every JS engine this app targets, so equal ranks keep Jellyfin's own order.
 */
function sortStreams(streams: TranscodeStream[]): TranscodeStream[] {
  return [...streams].sort((a, b) => sortRank(a) - sortRank(b));
}

// --- fetch --------------------------------------------------------------

export async function getTranscodeSnapshot(): Promise<TranscodeSnapshot> {
  const creds = jellyfinCredentials();
  if (!creds) {
    return {
      ok: false,
      reason: "not-configured",
      detail:
        'No Jellyfin API key configured. Add a "jellyfin" block to data/config.json: ' +
        '{ "jellyfin": { "url": "http://<host>:8096", "key": "<API key>" } } ' +
        "— generate a key in Jellyfin under Dashboard -> API Keys.",
    };
  }

  let res: Response;
  try {
    res = await fetch(`${creds.url}/Sessions`, {
      headers: { Authorization: `MediaBrowser Token="${creds.key}"` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "unreachable", detail: "Jellyfin did not respond within 3s." };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "unauthorized", detail: `Jellyfin rejected the API key (HTTP ${res.status}).` };
  }
  if (!res.ok) {
    return { ok: false, reason: "error", detail: `Jellyfin returned HTTP ${res.status}.` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "error", detail: "Jellyfin returned a non-JSON response." };
  }
  if (!Array.isArray(body)) {
    return { ok: false, reason: "error", detail: "Jellyfin /Sessions did not return an array." };
  }

  const streams = (body as JellyfinSession[])
    .filter((session) => Boolean(session?.NowPlayingItem))
    .map(mapSession);

  return { ok: true, streams: sortStreams(streams) };
}

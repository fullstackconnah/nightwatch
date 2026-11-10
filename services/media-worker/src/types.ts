// The one contract between the media worker and the nightwatch page. It imports
// nothing, so the dashboard image can build with only this file (see .dockerignore).

export type Verdict =
  | { kind: "compress"; ratio: number; targetKbps: number; crf: number; tune: "grain" | null; estSavingBytes: number; reason: string }
  | { kind: "ok"; ratio: number | null; reason: string }
  | { kind: "skip"; reason: string }
  | { kind: "cant"; reason: string };

export type Res = "480p" | "720p" | "1080p" | "2160p";

export type JobState =
  | "queued" | "encoding" | "verifying" | "swapping" | "done" | "failed" | "cancelled" | "undone" | "purged";

export interface MediaFile {
  /** Relative to the media root, e.g. "movies/Alien (1979)/Alien.mkv". The only id the API uses. */
  path: string;
  name: string;
  bytes: number;
  mtimeMs: number;
  nlink: number;
  durationSec: number | null;
  /** First token of ffprobe's format_name: "matroska" | "mov" | "avi" | "webm" ... */
  container: string;
  video: {
    codec: string;
    profile: string | null;
    width: number;
    height: number;
    res: Res;
    kbps: number | null;
    kbpsSource: "stream" | "tag" | "estimated" | null;
    tenBit: boolean;
    hdr: null | "HDR10" | "HLG" | "Dolby Vision";
    wideColour: boolean;
    interlaced: boolean;
  } | null;
  /** Video streams that are not attached pictures (cover art). */
  videoStreams: number;
  /** Attachment streams (fonts). */
  attachments: number;
  audio: { codec: string; channels: number | null; lang: string | null }[];
  subs: { codec: string; lang: string | null }[];
  verdict: Verdict;
  probeError?: string;
  job?: { id: string; state: JobState };
}

export interface TitleSummary {
  /** Relative dir, e.g. "tv/Bluey"; for a loose movie file, the file's relative path. */
  id: string;
  kind: "movie" | "show";
  name: string;
  bytes: number;
  files: number;
  compressible: number;
  estSavingBytes: number;
}

export interface TitleDetail extends Omit<TitleSummary, "files"> {
  seasons?: { name: string; bytes: number; files: MediaFile[] }[];
  files?: MediaFile[];
}

export interface ScanState {
  state: "idle" | "running" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  filesDone: number;
  filesTotal: number | null;
  /** Entries the walk could not read (readdir or lstat error); they never abort the scan. A probe failure shows on its file's row instead. */
  skipped: number;
  error?: string;
}

export interface Health {
  ok: true;
  version: string;
  compressEnabled: boolean;
  compressReady: boolean;
  reason?: string;
}

export interface LibraryResponse {
  scan: ScanState;
  scannedAt: string | null;
  totals: { bytes: number; files: number; titles: number; compressible: number; estSavingBytes: number };
  disk: { sizeBytes: number; freeBytes: number; heldBytes: number };
  titles: TitleSummary[];
}

export interface Job {
  id: string;
  path: string;
  state: JobState;
  batchId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  crf: number;
  sourceBytes: number;
  outputBytes?: number;
  progress?: { pct: number; fps: number | null; etaSec: number | null };
  failedCheck?:
    | "probe" | "duration" | "streams" | "decode" | "frames" | "saving" | "small-saving"
    | "source-changed" | "disk" | "restart" | "encoder" | "swap";
  /** Seconds shorter (duration) or percent saved (saving), for the page copy. */
  failedValue?: number;
  error?: string;
  heldUntil?: string;
  jellyfin?: "told" | "failed" | "off";
  attempts: number;
}

export interface JobsResponse {
  compressEnabled: boolean;
  compressReady: boolean;
  reason?: string;
  current: Job | null;
  queue: Job[];
  recent: Job[];
}

/** POST /jobs takes one of these. */
export type EnqueueBody = { path: string } | { paths: string[] };
export interface BatchResponse {
  batchId: string;
  jobs: Job[];
}

export interface ErrorBody {
  error: string;
}

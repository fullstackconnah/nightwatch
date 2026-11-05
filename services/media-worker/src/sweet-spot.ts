// Every tunable number lives here; calibration edits only this file.
import type { Res } from "./types.ts";

export type Kind = "film" | "tv";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const SWEET_KBPS: Record<Res, Record<Kind, number>> = {
  "480p": { film: 1000, tv: 800 },
  "720p": { film: 2000, tv: 1500 },
  "1080p": { film: 3500, tv: 2500 },
  "2160p": { film: 9000, tv: 7000 },
};

// Calibrated 2026-11-06 (VMAF mean >= 93, 1% low >= 85): 1080p film needed CRF 18 (Bourne: 93.4 / 85.0, about 72% smaller);
// tv passed at 22. Other film rows take the same -3 offset unmeasured.
export const CRF: Record<Res, Record<Kind, number>> = {
  "480p": { film: 18, tv: 22 },
  "720p": { film: 18, tv: 22 },
  "1080p": { film: 18, tv: 22 },
  "2160p": { film: 19, tv: 23 },
};

/** Flag a file when kbps / sweet spot reaches this. A codec with no entry is never flagged. */
export const FLAG_RATIO: Record<string, number> = {
  h264: 1.5,
  mpeg2video: 1.3,
  vc1: 1.3,
  mpeg4: 1.3,
  hevc: 3.0,
  av1: 3.0,
  vp9: 3.0,
};
export const EFFICIENT_CODECS = new Set(["hevc", "av1", "vp9"]);
export const EFFICIENT_CODEC_PENALTY = 0.1;
export const MIN_SAVING_PCT = 0.2;

// PR B reads these; they sit here so calibration has one file to edit.
export const DISK_MARGIN_BYTES = 20 * GB;
export const DISK_ABORT_BYTES = 10 * GB;
export const HOLD_DAYS = 7;
export const PRESET = "medium";
export const X265_POOLS = 8;
/** 1 kbit/s for 1 s is 125 bytes. */
export const BYTES_PER_KBPS_SEC = 125;

export interface Thresholds {
  MIN_FILE_BYTES: number;
  MIN_SAVING_BYTES: number;
}

/**
 * Only the two size floors scale, and only when the variable is exactly "1"
 * (unset or "0" means real thresholds). The disk guards never scale.
 */
export function thresholds(env: Record<string, string | undefined> = process.env): Thresholds {
  const scale = env.MEDIA_WORKER_TEST_THRESHOLDS === "1" ? MB : 1;
  return { MIN_FILE_BYTES: (500 * MB) / scale, MIN_SAVING_BYTES: (500 * MB) / scale };
}

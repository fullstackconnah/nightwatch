import type { MediaFile, Verdict } from "./types.ts";
import {
  BYTES_PER_KBPS_SEC, CRF, TUNE, EFFICIENT_CODECS, EFFICIENT_CODEC_PENALTY, FLAG_RATIO, MIN_SAVING_PCT, SWEET_KBPS,
  thresholds, type Kind, type Thresholds,
} from "./sweet-spot.ts";

export type VerdictInput = Omit<MediaFile, "verdict">;

const round2 = (n: number) => Math.round(n * 100) / 100;

const CONTAINER_LABEL: Record<string, string> = {
  avi: "AVI", asf: "ASF", flv: "FLV", mpeg: "MPEG", mpegps: "MPEG", mpegts: "MPEG-TS", webm: "WebM",
};
const SUB_LABEL: Record<string, string> = {
  hdmv_pgs_subtitle: "PGS", dvd_subtitle: "DVD", subrip: "SRT", ass: "ASS", ssa: "SSA", webvtt: "WebVTT",
};
const MP4_SUBS = new Set(["mov_text", "tx3g"]);

/** Why this file can't keep its own container once re-encoded to HEVC, or null if it can. */
export function containerProblem(f: VerdictInput): string | null {
  if (f.container === "matroska") return null;
  if (f.container === "mov") {
    const bad = f.subs.find((s) => !MP4_SUBS.has(s.codec));
    if (bad) return `MP4 can't hold ${SUB_LABEL[bad.codec] ?? bad.codec} subtitles`;
    if (f.attachments > 0) return "MP4 can't hold attachments";
    return null;
  }
  return `${CONTAINER_LABEL[f.container] ?? f.container.toUpperCase()} can't hold HEVC here`;
}

/** Pure: the first rule that matches wins (PLAN §2, with the plan-check fixes). */
export function verdict(f: VerdictInput, kind: Kind, th: Thresholds = thresholds()): Verdict {
  const v = f.video;
  if (!v || f.probeError) return { kind: "skip", reason: "Couldn't read this file" };

  const problem = containerProblem(f);
  if (problem) return { kind: "cant", reason: problem };
  if (f.videoStreams > 1) return { kind: "cant", reason: "More than one video track" };

  if (v.hdr) return { kind: "skip", reason: v.hdr };
  if (v.wideColour) return { kind: "skip", reason: "Wide colour (BT.2020)" };
  if (v.tenBit) return { kind: "skip", reason: "10-bit" };
  if (v.interlaced) return { kind: "skip", reason: "Interlaced" };

  const sweet = SWEET_KBPS[v.res][kind];
  const dur = f.durationSec;
  const ratio = v.kbps !== null ? round2(v.kbps / sweet) : null;

  if (f.nlink > 1) {
    return { kind: "ok", ratio, reason: "Shared with another file; compressing won't free space" };
  }
  if (f.bytes < th.MIN_FILE_BYTES) return { kind: "ok", ratio, reason: "Small file" };
  if (v.kbps === null || ratio === null || !dur) return { kind: "ok", ratio: null, reason: "Bitrate unknown" };

  const flag = FLAG_RATIO[v.codec];
  if (flag === undefined || ratio < flag) {
    return { kind: "ok", ratio, reason: ratio < 1 ? "Already under the sweet spot" : "Close to the sweet spot" };
  }

  const videoBytes = v.kbps * dur * BYTES_PER_KBPS_SEC;
  const nonVideoBytes = Math.max(0, f.bytes - videoBytes);
  const estOut = sweet * dur * BYTES_PER_KBPS_SEC + nonVideoBytes;
  let estSaving = f.bytes - estOut;
  if (EFFICIENT_CODECS.has(v.codec)) estSaving -= estSaving * EFFICIENT_CODEC_PENALTY;
  if (estSaving < th.MIN_SAVING_BYTES || estSaving / f.bytes < MIN_SAVING_PCT) {
    return { kind: "ok", ratio, reason: "Saving too small" };
  }

  return {
    kind: "compress",
    ratio,
    targetKbps: sweet,
    crf: CRF[v.res][kind],
    tune: TUNE[v.res][kind],
    estSavingBytes: Math.round(estSaving),
    reason: `${ratio}× the sweet spot for ${v.res} ${kind === "film" ? "film" : "TV"}`,
  };
}

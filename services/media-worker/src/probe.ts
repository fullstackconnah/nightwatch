import { execFile } from "node:child_process";
import type { Res } from "./types.ts";
import type { VerdictInput } from "./verdict.ts";

export interface FileStat {
  path: string;
  name: string;
  bytes: number;
  mtimeMs: number;
  nlink: number;
}

/** Every probe and encode runs at the lowest CPU and IO priority. */
export const NICE = ["nice", "-n", "19", "ionice", "-c", "3"];

export const FFPROBE_ARGS = [
  "-v", "error",
  "-show_entries",
  "format=duration,size,bit_rate,format_name:stream=index,codec_type,codec_name,profile,width,height,pix_fmt,field_order,color_transfer,color_primaries,r_frame_rate,avg_frame_rate,bit_rate,channels:stream_disposition=attached_pic:stream_tags=BPS,BPS-eng,language:stream_side_data=side_data_type",
  "-of", "json",
];

/** The larger of the height and the 16:9 height, so a 1920x800 scope film lands in 1080p. */
export function bucketRes(width: number, height: number): Res {
  const h = Math.max(height, Math.round((width * 9) / 16));
  if (h <= 576) return "480p";
  if (h <= 800) return "720p";
  if (h <= 1200) return "1080p";
  return "2160p";
}

interface RawStream {
  codec_type?: string; codec_name?: string; profile?: string; width?: number; height?: number;
  pix_fmt?: string; field_order?: string; color_transfer?: string; color_primaries?: string;
  bit_rate?: string; channels?: number; disposition?: { attached_pic?: number };
  tags?: Record<string, string>; side_data_list?: { side_data_type?: string }[];
}
interface RawProbe { format?: { duration?: string; size?: string; bit_rate?: string; format_name?: string }; streams?: RawStream[] }

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v !== undefined && v !== null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
const lang = (s: RawStream) => s.tags?.language ?? null;

export function probeFailure(st: FileStat, message: string): VerdictInput {
  return {
    ...st, durationSec: null, container: "", video: null, videoStreams: 0, attachments: 0,
    audio: [], subs: [], probeError: message,
  };
}

/** Pure: ffprobe's JSON plus the lstat numbers in, a MediaFile without its verdict out. */
export function parseProbe(json: unknown, st: FileStat): VerdictInput {
  const p = (json ?? {}) as RawProbe;
  const streams = p.streams ?? [];
  const videos = streams.filter((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const main = videos[0];
  const audio = streams.filter((s) => s.codec_type === "audio");
  const durationSec = num(p.format?.duration);

  let container = (p.format?.format_name ?? "").split(",")[0];
  // ffprobe reports webm as "matroska,webm"; only the extension tells them apart.
  if (container === "matroska" && st.name.toLowerCase().endsWith(".webm")) container = "webm";

  let video: VerdictInput["video"] = null;
  if (main) {
    let kbps: number | null = null;
    let kbpsSource: "stream" | "tag" | "estimated" | null = null;
    const streamBps = num(main.bit_rate);
    // A tag that implies more bytes than the file holds is stale (ffmpeg copies mkvmerge's tags).
    const tagBps = num(main.tags?.BPS ?? main.tags?.["BPS-eng"]);
    const tagFits = tagBps !== null && (durationSec === null || (tagBps * durationSec) / 8 <= st.bytes);
    if (streamBps !== null) {
      kbps = streamBps / 1000; kbpsSource = "stream";
    } else if (tagBps !== null && tagFits) {
      kbps = tagBps / 1000; kbpsSource = "tag";
    } else if (durationSec !== null) {
      const audioBps = audio.reduce((sum, a) => sum + (num(a.bit_rate) ?? 0), 0);
      const est = ((st.bytes * 8) / durationSec - audioBps) / 1000;
      if (est > 0) { kbps = est; kbpsSource = "estimated"; }
    }
    const width = main.width ?? 0;
    const height = main.height ?? 0;
    const sideData = (main.side_data_list ?? []).map((d) => d.side_data_type ?? "");
    const hdr = sideData.some((d) => d.includes("DOVI")) ? "Dolby Vision"
      : main.color_transfer === "smpte2084" ? "HDR10"
      : main.color_transfer === "arib-std-b67" ? "HLG" : null;
    video = {
      codec: main.codec_name ?? "unknown", profile: main.profile ?? null, width, height,
      res: bucketRes(width, height),
      kbps: kbps === null ? null : Math.round(kbps), kbpsSource,
      tenBit: /(10|12)(le|be)$/.test(main.pix_fmt ?? ""),
      hdr, wideColour: main.color_primaries === "bt2020",
      // "unknown" is what ffprobe says for many progressive files.
      interlaced: ["tt", "bb", "tb", "bt"].includes(main.field_order ?? ""),
    };
  }

  return {
    path: st.path, name: st.name, bytes: st.bytes, mtimeMs: st.mtimeMs, nlink: st.nlink,
    durationSec, container, video,
    videoStreams: videos.length,
    attachments: streams.filter((s) => s.codec_type === "attachment").length,
    audio: audio.map((a) => ({ codec: a.codec_name ?? "unknown", channels: a.channels ?? null, lang: lang(a) })),
    subs: streams.filter((s) => s.codec_type === "subtitle").map((s) => ({ codec: s.codec_name ?? "unknown", lang: lang(s) })),
  };
}

/** A short fixed reason: never the command line or an absolute path. */
export function probeReason(err: { killed?: boolean; stderr?: unknown }, abs: string): string {
  if (err.killed) return "ffprobe timed out";
  const line = String(err.stderr ?? "").split("\n")[0].split(abs).join("").trim().slice(0, 120);
  return line ? `ffprobe failed: ${line}` : "ffprobe failed";
}

/** Runs ffprobe (60 s limit). Never throws: a failure becomes probeError. */
export function probeFile(
  abs: string, st: FileStat, opts: { prefix?: string[]; timeoutMs?: number } = {},
): Promise<VerdictInput> {
  const [cmd, ...pre] = [...(opts.prefix ?? NICE), "ffprobe"];
  return new Promise((resolve) => {
    execFile(cmd, [...pre, ...FFPROBE_ARGS, abs], { timeout: opts.timeoutMs ?? 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolve(probeFailure(st, probeReason({ killed: err.killed, stderr }, abs)));
      try {
        resolve(parseProbe(JSON.parse(stdout), st));
      } catch {
        resolve(probeFailure(st, "Not a media file"));
      }
    });
  });
}

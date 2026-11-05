// The ffmpeg argv for one Compress job (PLAN B1 with the plan-check fixes S2 and S7). Pure.
import { NICE } from "./probe.ts";
import { PRESET, X265_POOLS } from "./sweet-spot.ts";

export interface StreamInfo {
  index: number;
  type: string;
  attachedPic: boolean;
}

interface RawStream { index?: number; codec_type?: string; disposition?: { attached_pic?: number } }

/** The stream list of ffprobe's JSON, in input order. */
export function streamInfos(json: unknown): StreamInfo[] {
  const streams = ((json ?? {}) as { streams?: RawStream[] }).streams ?? [];
  return streams.map((s, i) => ({
    index: s.index ?? i, type: s.codec_type ?? "", attachedPic: Boolean(s.disposition?.attached_pic),
  }));
}

/** The first video stream that is not cover art (the one that gets re-encoded). */
export const mainVideo = (streams: StreamInfo[]): StreamInfo | undefined =>
  streams.find((s) => s.type === "video" && !s.attachedPic);

// mkvmerge's statistics tags describe the H.264 source; left on the HEVC stream they make the re-probe read the old bitrate (S2).
const STALE_TAGS = [
  "BPS", "NUMBER_OF_BYTES", "NUMBER_OF_FRAMES", "DURATION",
].flatMap((t) => [t, `${t}-eng`]);

/**
 * `nice … ffmpeg …` argv. Every input stream except data streams is mapped explicitly, in input order; everything is
 * copied except the main video, which becomes HEVC. Never a -r, -vf or scale: frame rate and size stay as they were.
 */
export function encodeArgs(
  o: { src: string; out: string; container: string; streams: StreamInfo[]; crf: number; prefix?: string[] },
): string[] {
  const mapped = o.streams.filter((s) => s.type !== "data");
  const video = mainVideo(mapped);
  if (!video) throw new Error("No video stream to encode");
  const outIdx = mapped.indexOf(video);
  const mp4 = o.container === "mov";
  return [
    ...(o.prefix ?? NICE), "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", o.src,
    ...mapped.flatMap((s) => ["-map", `0:${s.index}`]),
    "-map_chapters", "0", "-map_metadata", "0",
    "-c", "copy",
    `-c:${outIdx}`, "libx265", "-preset", PRESET, "-crf", String(o.crf), "-pix_fmt", "yuv420p",
    // hvc1 is what Apple players need in MP4; Matroska may refuse the tag (S7), so it is MP4 only.
    ...(mp4 ? [`-tag:${outIdx}`, "hvc1"] : []),
    "-x265-params", `log-level=error:pools=${X265_POOLS}`,
    ...STALE_TAGS.flatMap((t) => [`-metadata:s:${outIdx}`, `${t}=`]),
    "-fps_mode", "passthrough", "-max_muxing_queue_size", "4096",
    ...(mp4 ? ["-f", "mp4", "-movflags", "+faststart"] : ["-f", "matroska"]),
    "-progress", "pipe:1", "-stats_period", "5",
    o.out,
  ];
}

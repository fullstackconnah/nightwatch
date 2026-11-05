// Test helper (not a test): makes a small synthetic clip with ffmpeg. Used by the verify, runner and calibrate tests.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * A 4 s 1280x720 H.264 CBR clip. `mkv`: two audio tracks (eng, jpn), an srt subtitle and a 2-chapter map.
 * `mp4`: one audio track and a mov_text subtitle.
 */
export function makeClip(out: string, o: { kind: "mkv" | "mp4"; seconds?: number; tagBps?: boolean; hdr?: boolean }): void {
  const dir = dirname(out);
  const srt = join(dir, "clip.srt");
  writeFileSync(srt, "1\n00:00:00,500 --> 00:00:02,000\nHello\n");
  const meta = join(dir, "clip.ffmeta");
  writeFileSync(meta, ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=2000\ntitle=One\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=2000\nEND=4000\ntitle=Two\n");
  const sec = String(o.seconds ?? 4);
  const mkv = o.kind === "mkv";
  const args = [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=24:duration=${sec}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${sec}`,
    ...(mkv ? ["-f", "lavfi", "-i", `sine=frequency=880:duration=${sec}`] : []),
    "-i", srt, ...(mkv ? ["-i", meta] : []),
    "-map", "0:v", "-map", "1:a", ...(mkv ? ["-map", "2:a", "-map", "3:s", "-map_chapters", "4"] : ["-map", "2:s"]),
    "-c:v", "libx264", "-b:v", "15M", "-minrate", "15M", "-maxrate", "15M", "-bufsize", "15M", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-c:s", mkv ? "srt" : "mov_text",
    "-metadata:s:a:0", "language=eng", ...(mkv ? ["-metadata:s:a:1", "language=jpn"] : []),
    ...(mkv ? ["-metadata:s:s:0", "language=eng"] : []),
    ...(o.tagBps ? ["-metadata:s:v:0", "BPS=20000000"] : []),
    ...(o.hdr ? ["-x264-params", "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc"] : []),
    out,
  ];
  execFileSync("ffmpeg", args, { stdio: "pipe" });
}

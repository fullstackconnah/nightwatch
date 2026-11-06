// Calibration helper (PLAN B10): `node --experimental-strip-types src/calibrate.ts <rel1> <rel2> <rel3>`.
// Cuts 60 s from the middle of each file and encodes it at CRF-2, CRF and CRF+2, so the owner can pick numbers by eye.
// It only reads the library and writes inside .nightwatch/calibration/.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkReady, type Dirs } from "./disk.ts";
import { encodeArgs, streamInfos } from "./encode-args.ts";
import { createGuard } from "./fsguard.ts";
import { resolveMediaPath } from "./paths.ts";
import { NICE, ffprobeJson, parseProbe } from "./probe.ts";
import { CRF, SWEET_KBPS, TUNE } from "./sweet-spot.ts";

export interface CalibRow {
  file: string;
  crf: number;
  bytes: number;
  kbps: number;
  /** kbps divided by the sweet spot for this resolution. */
  vsSweet: number;
  vmafMean: number | null;
  vmaf1Low: number | null;
}

export interface CalibOpts {
  rels: string[];
  mediaRoot: string;
  dirs: Dirs;
  cutSec?: number;
  prefix?: string[];
  /** Output of `ffmpeg -filters`; injected so a test can say libvmaf is missing. */
  filters?: string;
  resolve?: (rel: string, root: string) => { abs: string } | { error: string };
  log?: (line: string) => void;
}

const ff = (prefix: string[], argv: string[]) => execFileSync(prefix[0] ?? argv[0], [...prefix.slice(1), ...(prefix.length ? argv : argv.slice(1))], { stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });

function vmaf(prefix: string[], enc: string, ref: string, logFile: string): { mean: number; low: number } {
  ff(prefix, ["ffmpeg", "-nostdin", "-v", "error", "-i", enc, "-i", ref, "-lavfi", `[0:v][1:v]libvmaf=log_fmt=json:log_path=${logFile}`, "-f", "null", "-"]);
  const j = JSON.parse(readFileSync(logFile, "utf8")) as { pooled_metrics: { vmaf: { mean: number } }; frames: { metrics: { vmaf: number } }[] };
  const per = j.frames.map((f) => f.metrics.vmaf).sort((a, b) => a - b);
  return { mean: j.pooled_metrics.vmaf.mean, low: per[Math.floor(per.length * 0.01)] ?? per[0] };
}

export async function calibrate(o: CalibOpts): Promise<CalibRow[]> {
  const prefix = o.prefix ?? NICE;
  const cutSec = o.cutSec ?? 60;
  const filters = o.filters ?? execFileSync("ffmpeg", ["-hide_banner", "-filters"]).toString();
  const haveVmaf = /\blibvmaf\b/.test(filters);
  const resolve = o.resolve ?? resolveMediaPath;
  const rows: CalibRow[] = [];
  for (const rel of o.rels) {
    const r = resolve(rel, o.mediaRoot);
    if ("error" in r) throw new Error(`${rel}: ${r.error}`);
    const json = await ffprobeJson(r.abs, { prefix });
    const st = statSync(r.abs);
    const input = parseProbe(json, { path: rel, name: basename(r.abs), bytes: st.size, mtimeMs: st.mtimeMs, nlink: st.nlink });
    if (!input.video) throw new Error(`${rel}: no video`);
    const kind = rel.startsWith("movies/") ? "film" : "tv";
    const base = CRF[input.video.res][kind];
    const stem = rel.replaceAll("/", "_").replace(/\.[^.]+$/, "");
    const cut = join(o.dirs.calibration, `${stem}-cut.mkv`);
    const mid = Math.max(0, Math.floor(((input.durationSec ?? cutSec) - cutSec) / 2));
    ff(prefix, ["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", String(mid), "-t", String(cutSec), "-i", r.abs, "-map", "0:v:0", "-an", "-sn", "-c", "copy", cut]);
    const cutStreams = streamInfos(await ffprobeJson(cut, { prefix }));
    for (const crf of [base - 2, base, base + 2]) {
      const out = join(o.dirs.calibration, `${stem}-crf${crf}.mkv`);
      const argv = encodeArgs({ src: cut, out, container: "matroska", streams: cutStreams, crf, tune: TUNE[input.video.res][kind], prefix });
      ff(prefix, argv.slice(prefix.length));
      const bytes = statSync(out).size;
      const kbps = Math.round((bytes * 8) / cutSec / 1000);
      let score: { mean: number; low: number } | null = null;
      if (haveVmaf) score = vmaf(prefix, out, cut, join(o.dirs.calibration, `${stem}-crf${crf}.json`));
      rows.push({
        file: rel, crf, bytes, kbps, vsSweet: Math.round((kbps / SWEET_KBPS[input.video.res][kind]) * 100) / 100,
        vmafMean: score ? Math.round(score.mean * 100) / 100 : null, vmaf1Low: score ? Math.round(score.low * 100) / 100 : null,
      });
    }
  }
  return rows;
}

export function formatRows(rows: CalibRow[], haveVmaf: boolean): string {
  const head = "file | crf | size (MB) | kbps | vs sweet | vmaf mean | vmaf 1% low";
  const body = rows.map((r) =>
    [r.file, r.crf, (r.bytes / 1e6).toFixed(1), r.kbps, r.vsSweet, r.vmafMean ?? "n/a", r.vmaf1Low ?? "n/a"].join(" | "));
  return [head, ...body, ...(haveVmaf ? [] : ["VMAF unavailable: eyeball check"])].join("\n");
}

/** `--clean`: removes what calibration wrote, only through the guard. */
export function clean(dirs: Dirs): number {
  const guard = createGuard(dirs);
  let n = 0;
  for (const f of readdirSync(dirs.calibration)) { guard.removeInside(dirs.calibration, join(dirs.calibration, f)); n++; }
  return n;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mediaRoot = process.env.MEDIA_ROOT ?? "/mnt/media";
  const ready = checkReady(mediaRoot);
  const args = process.argv.slice(2);
  if (!ready.ready) { console.error(ready.reason); process.exit(1); }
  if (args[0] === "--clean") console.log(`removed ${clean(ready.dirs)} files`);
  else {
    const filters = execFileSync("ffmpeg", ["-hide_banner", "-filters"]).toString();
    calibrate({ rels: args, mediaRoot, dirs: ready.dirs, filters }).then(
      (rows) => console.log(formatRows(rows, /\blibvmaf\b/.test(filters))),
      (e: Error) => { console.error(e.message); process.exit(1); },
    );
  }
}

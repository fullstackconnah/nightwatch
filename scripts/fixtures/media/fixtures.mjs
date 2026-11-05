/* Fixtures for scripts/media-shots.mjs: the /api/media/library bodies and the per-title detail answers for every PR A
 * capture state. Names are placeholders; nothing here names a real host or path. The browser clock is pinned to NOW
 * (Sydney, 20:30), and every scannedAt is NOW minus two hours, so ages are exact. The planted "leak" strings (an
 * address and a mount path inside scan.error and probeError) are built from parts at run time so the source stays free
 * of them; C10 checks the page never renders them. */

export const NOW = Date.parse("2026-11-05T20:30:00+11:00");
const HOUR = 3_600_000;
export const SCANNED_AT = new Date(NOW - 2 * HOUR).toISOString();

const GIB = 1024 ** 3;
const gb = (n) => Math.round(n * GIB);
const LEAK_ADDR = ["10", "0", "0", "5"].join(".");
const LEAK_PATH = ["", "mnt", "media", "x"].join("/");

const RES = { "480p": [854, 480], "720p": [1280, 720], "1080p": [1920, 1080], "2160p": [3840, 2160] };

/** One probed file; verdict "compress" carries a ratio and a saving, "ok" a ratio or null, "skip"/"cant" a reason. */
const file = (path, { size = 4, res = "1080p", codec = "h264", kbps = 8000, source = "stream", verdict = "ok", ratio = null, save = 0, reason = "", hdr = null, probeError } = {}) => {
  const [width, height] = RES[res];
  const name = path.split("/").pop();
  const v =
    verdict === "compress"
      ? { kind: "compress", ratio, targetKbps: Math.round(kbps / ratio), crf: 23, estSavingBytes: gb(save), reason: reason || "Re-encode to HEVC" }
      : verdict === "ok"
        ? { kind: "ok", ratio, reason: reason || "Already efficient" }
        : { kind: verdict, reason: reason || (verdict === "skip" ? "Already HEVC" : "Can’t read this file") };
  return {
    path, name, bytes: gb(size), mtimeMs: NOW - 40 * 24 * HOUR, nlink: 1, durationSec: 6600, container: "matroska",
    video: { codec, profile: null, width, height, res, kbps, kbpsSource: source, tenBit: false, hdr, wideColour: false, interlaced: false },
    videoStreams: 1, attachments: 0, audio: [{ codec: "eac3", channels: 6, lang: "eng" }], subs: [{ codec: "subrip", lang: "eng" }],
    verdict: v, ...(probeError ? { probeError } : {}),
  };
};

const sum = (files) => files.reduce((n, f) => n + f.bytes, 0);
const savers = (files) => files.filter((f) => f.verdict.kind === "compress");
const summary = (id, kind, name, files) => ({
  id, kind, name, bytes: sum(files), files: files.length, compressible: savers(files).length,
  estSavingBytes: savers(files).reduce((n, f) => n + f.verdict.estSavingBytes, 0),
});
const movie = (name, f) => ({ detail: { ...summary(`movies/${name}`, "movie", name, [f]), files: [f] }, files: [f] });
const season = (name, files) => ({ name, bytes: sum(files), files });
const show = (name, seasons) => {
  const all = seasons.flatMap((s) => s.files);
  const { files: _count, ...base } = summary(`tv/${name}`, "show", name, all); // the worker sends no `files` for a show
  return { detail: { ...base, seasons }, files: all };
};

/** Normal: 12 titles (9 movies, 3 shows), 7 of them could save space. */
const sav = (p, size, kbps, ratio, save, extra = {}) => file(p, { size, kbps, ratio, save, verdict: "compress", ...extra });
const longScene = ["Some.Long.Scene.Release.Name.2019.2160p.UHD.BluRay.REMUX.HDR.HEVC.TrueHD.7.1.Atmos-GROUP", "x".repeat(20), "mkv"].join(".").slice(0, 120);
const movies = [
  movie("Alien (1979)", sav("movies/Alien (1979)/Alien.mkv", 12, 18000, 2.3, 6.8)),
  movie("Blade Runner (1982)", sav("movies/Blade Runner (1982)/Blade Runner.mkv", 9, 14000, 2.1, 4.7)),
  movie("Casablanca (1942)", file("movies/Casablanca (1942)/Casablanca.mkv", { size: 2, res: "720p", kbps: 2500, ratio: 1.1 })),
  movie("Heat (1995)", sav("movies/Heat (1995)/Heat.mkv", 15, 22000, 2.6, 9.2)),
  movie("Jaws (1975)", file("movies/Jaws (1975)/Jaws.mkv", { size: 3, codec: "hevc", kbps: 3500, verdict: "skip" })),
  movie("Metropolis (1927)", file("movies/Metropolis (1927)/Metropolis.mkv", { size: 1, res: "480p", kbps: 1200, verdict: "cant", probeError: `ffprobe failed on ${LEAK_PATH}` })),
  movie("Psycho (1960)", sav("movies/Psycho (1960)/Psycho.mkv", 6, 9000, 1.9, 2.9)),
  movie("Tom & Jerry (1992)", sav("movies/Tom & Jerry (1992)/Tom & Jerry.mkv", 5, 7000, 1.8, 2.2)),
  movie("It's #1", file("movies/It's #1/It's #1.mkv", { size: 7, kbps: 10000, ratio: 1.2 })),
];
const bluey = show("Bluey", [
  season("Season 1", Array.from({ length: 6 }, (_, i) => file(`tv/Bluey/Season 1/Bluey S01E0${i + 1}.mkv`, { size: 1, res: "720p", kbps: 2000, ratio: 1.2 }))),
  season("Season 2", Array.from({ length: 6 }, (_, i) => file(`tv/Bluey/Season 2/Bluey S02E0${i + 1}.mkv`, { size: 1, res: "720p", kbps: 2000, ratio: 1.2 }))),
]);
const bigShow = show("A  B", [
  season("Season 1", Array.from({ length: 12 }, (_, i) => sav(`tv/A  B/Season 1/E${String(i + 1).padStart(2, "0")}.mkv`, 4, 9000, 2.2, 2.1, i === 0 ? { reason: "Re-encode to HEVC" } : {}))),
  season("Season 2", Array.from({ length: 11 }, (_, i) => file(`tv/A  B/Season 2/E${String(i + 1).padStart(2, "0")}.mkv`, { size: 3, kbps: 5000, ratio: 1.3 }))),
  season("Other", [file(`tv/A  B/Other/${longScene}`, { size: 3, kbps: 6000, ratio: 1.4 })]),
]);
const mixed = show("Severance", [
  season("Season 1", [
    sav("tv/Severance/Season 1/S01E01.mkv", 5, 12000, 2.4, 3.1),
    file("tv/Severance/Season 1/S01E02.mkv", { size: 4, codec: "hevc", kbps: 4000, verdict: "skip" }),
    file("tv/Severance/Season 1/S01E03.mkv", { size: 4, kbps: null, source: null, verdict: "cant", reason: "Can’t read this file" }),
    file("tv/Severance/Season 1/S01E04.mkv", { size: 4, kbps: 6000, source: "estimated", ratio: 1.2 }),
  ]),
]);

const titleSet = [...movies, bluey, bigShow, mixed];
const withScan = (extra = {}) => ({
  scan: { state: "idle", startedAt: new Date(NOW - 2 * HOUR - 600_000).toISOString(), finishedAt: SCANNED_AT, filesDone: 0, filesTotal: null, skipped: 0, ...extra },
  scannedAt: SCANNED_AT,
});
const library = (sets, { scan = {}, disk = { sizeBytes: gb(4000), freeBytes: gb(1500), heldBytes: 0 }, scannedAt } = {}) => {
  const summaries = sets.map((s) => s.detail);
  const base = withScan(scan);
  return {
    ...base,
    ...(scannedAt !== undefined ? { scannedAt } : {}),
    totals: {
      bytes: summaries.reduce((n, t) => n + t.bytes, 0),
      files: sets.reduce((n, s) => n + s.files.length, 0),
      titles: summaries.length,
      compressible: summaries.reduce((n, t) => n + t.compressible, 0),
      estSavingBytes: summaries.reduce((n, t) => n + t.estSavingBytes, 0),
    },
    disk,
    titles: summaries.map((t, i) => ({ ...t, files: sets[i].files.length })),
  };
};
const detailsOf = (sets) => Object.fromEntries(sets.map((s) => [s.detail.id, s.detail]));
const ok = (sets, opts) => ({ library: { worker: "ok", data: library(sets, opts) }, titles: detailsOf(sets) });

const noSaving = [movies[2], movies[4], bluey];
const stale = ok(titleSet, { scannedAt: new Date(NOW - 9 * 24 * HOUR).toISOString() });

/** 130 titles, 1,685 files in all (scale-130), and a 300-file show for the long list. */
const manyTitles = Array.from({ length: 130 }, (_, i) => {
  const n = String(i + 1).padStart(3, "0");
  const count = i < 125 ? 12 : 37;
  const files = Array.from({ length: count }, (__, j) => file(`tv/Show ${n}/Season 1/E${j + 1}.mkv`, { size: 1, kbps: 4000, ratio: 1.2, ...(j % 3 === 0 ? { verdict: "compress", ratio: 2, save: 0.4 } : {}) }));
  return show(`Show ${n}`, [season("Season 1", files)]);
});
const huge = show("Long Runner", [season("Season 1", Array.from({ length: 300 }, (_, i) => file(`tv/Long Runner/Season 1/E${i + 1}.mkv`, { size: 1, kbps: 3000, ratio: 1.2 })))]);

export const FIXTURES = {
  loading: { library: "hang" },
  unconfigured: { library: { worker: "unconfigured" } },
  tokenRejected: { library: { worker: "unauthorized" } },
  workerDown: { library: { worker: "unreachable" } },
  firstScan: { library: { worker: "ok", data: { ...library([], { scannedAt: null }), scannedAt: null, scan: { state: "running", startedAt: new Date(NOW - 60_000).toISOString(), finishedAt: null, filesDone: 14, filesTotal: null, skipped: 0 } } }, titles: {} },
  scanning: { ...ok(titleSet), library: { worker: "ok", data: { ...library(titleSet), scan: { state: "running", startedAt: new Date(NOW - 120_000).toISOString(), finishedAt: null, filesDone: 40, filesTotal: 120, skipped: 0 } } } },
  scanFailed: { ...ok(titleSet), library: { worker: "ok", data: { ...library(titleSet), scan: { state: "failed", startedAt: new Date(NOW - 600_000).toISOString(), finishedAt: new Date(NOW - 590_000).toISOString(), filesDone: 3, filesTotal: null, skipped: 0, error: `could not read ${LEAK_PATH} at ${LEAK_ADDR}` } } } },
  empty: ok([]),
  normal: ok(titleSet),
  stale,
  nothingToCompress: ok(noSaving),
  detailFailed: { ...ok(titleSet), titles: {} },
  longValues: ok(titleSet),
  scale130: ok(manyTitles),
  hugeShow: ok([huge]),
  liveNormal: ok(titleSet),
};

/** The title ids each state opens, by capture. */
export const OPEN = { movie: "movies/Alien (1979)", show: "tv/A  B", verdicts: "tv/Severance", missing: "movies/Gone (2001)" };

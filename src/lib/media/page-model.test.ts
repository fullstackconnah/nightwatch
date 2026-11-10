import assert from "node:assert/strict";
import { test } from "node:test";
import type { LibraryResponse, MediaFile, TitleSummary } from "../../../services/media-worker/src/types.ts";
import { fileRow, mediaBytes, mediaModel, seasonHead, stripId, type ModelInput } from "./page-model.ts";

const NOW = Date.parse("2026-11-05T09:30:00Z");
const HOUR = 3_600_000;
const GIB = 1024 ** 3;
const AT = new Date(NOW - 2 * HOUR).toISOString();

const title = (name: string, kind: "movie" | "show", gib: number, save = 0, files = 1): TitleSummary => ({
  id: `${kind === "movie" ? "movies" : "tv"}/${name}`,
  kind,
  name,
  bytes: gib * GIB,
  files,
  compressible: save ? 1 : 0,
  estSavingBytes: save * GIB,
});
const lib = (o: Partial<LibraryResponse> = {}): LibraryResponse => ({
  scan: { state: "idle", startedAt: AT, finishedAt: AT, filesDone: 0, filesTotal: null, skipped: 0 },
  scannedAt: AT,
  totals: { bytes: 3.1 * 1024 * GIB, files: 2841, titles: 3, compressible: 23, estSavingBytes: 640 * GIB },
  disk: { sizeBytes: 7.28 * 1024 * GIB, freeBytes: 2.7 * 1024 * GIB, heldBytes: 0 },
  titles: [title("Big Film (2001)", "movie", 40, 18), title("Bluey", "show", 30, 0, 12), title("Tom & Jerry (1992)", "movie", 5, 2)],
  ...o,
});
const input = (o: Partial<ModelInput> = {}): ModelInput => ({
  body: { worker: "ok", data: lib() },
  loadError: false,
  last: { data: lib(), at: NOW - 1000 },
  filter: "all",
  prevOrder: null,
  now: NOW,
  ...o,
});
const model = (o: Partial<ModelInput> = {}) => mediaModel(input(o));
const withScan = (scan: Partial<LibraryResponse["scan"]>, o: Partial<LibraryResponse> = {}) =>
  lib({ scan: { ...lib().scan, ...scan }, ...o });
const body = (data: LibraryResponse) => ({ body: { worker: "ok" as const, data }, last: { data, at: NOW } });
const PAUSED = "Controls are paused while the page shows old data.";

// ---- C19 units ----
test("units: GB with one decimal, TB from 1,000 GB, Mbit/s, ratio", () => {
  assert.equal(mediaBytes(999.9 * GIB), "999.9 GB");
  assert.equal(mediaBytes(1000 * GIB), "0.98 TB");
  assert.equal(mediaBytes(7.28 * 1024 ** 4), "7.28 TB");
  assert.equal(mediaBytes(999.97 * GIB), "0.98 TB");
  const f = fileRow(file({ kbps: 3499 }), "movie");
  assert.equal(f.cells.rate, "3.5 Mbit/s");
});

// ---- the §5 rows ----
test("loading", () => {
  const m = model({ body: undefined, last: null });
  assert.deepEqual(m.chip, { tone: "neutral", label: "Checking" });
  assert.equal(m.answer, "Connecting to the media worker…");
  assert.equal(m.evidence, "First answer usually takes a second");
  assert.deepEqual(m.action, { shown: true, enabled: false, reason: null });
  assert.equal(m.autoTarget, "keep");
  assert.equal(m.strips.length, 0);
});

test("unconfigured: a Settings link to #media, no Rescan", () => {
  const m = model({ body: { worker: "unconfigured" }, last: null });
  assert.deepEqual(m.chip, { tone: "neutral", label: "Not connected" });
  assert.equal(m.answer, "The media worker isn’t connected yet.");
  assert.equal(m.evidence, "Add the media worker’s address and token in Settings → Integrations.");
  assert.deepEqual(m.link, { href: "/settings#media", label: "Open Settings" });
  assert.equal(m.action.shown, false);
});

test("token rejected", () => {
  const m = model({ body: { worker: "unauthorized" }, last: null });
  assert.deepEqual(m.chip, { tone: "warn", label: "Token rejected" });
  assert.equal(m.answer, "The media worker rejected the token. Check it in Settings → Integrations.");
  assert.equal(m.evidence, "Nothing to show until the token works.");
  assert.equal(m.link?.href, "/settings#media");
  assert.equal(m.action.shown, false);
});

test("worker down, no data yet", () => {
  const m = model({ body: { worker: "unreachable" }, last: null });
  assert.deepEqual(m.chip, { tone: "warn", label: "Worker down" });
  assert.equal(m.answer, "The media worker isn’t answering. Checking again every 30 s.");
  assert.equal(m.evidence, "Nothing to show until it answers.");
  assert.equal(m.strips.length, 0);
  assert.equal(m.action.enabled, false);
  assert.equal(m.pollMs, 30_000);
});

test("worker down with data: the last scan, controls paused", () => {
  const m = model({ body: { worker: "unreachable" } });
  assert.equal(m.chip.label, "Worker down");
  assert.equal(m.answer, "The media worker isn’t answering. Showing the scan from 2 h ago.");
  assert.equal(m.evidence, "Scanned 2 h ago · 2,841 files");
  assert.equal(m.notice, PAUSED);
  assert.equal(m.action.enabled, false);
  assert.equal(m.strips.length, 3);
  assert.equal(m.autoTarget, "keep");
});

test("first scan: neutral, titles as they arrive, Rescan off", () => {
  const m = model(body(withScan({ state: "running", filesDone: 120, filesTotal: 2841 }, { scannedAt: null })));
  assert.deepEqual(m.chip, { tone: "neutral", label: "Scanning" });
  assert.equal(m.answer, "Scanning the library for the first time: 120 of 2,841 files.");
  assert.equal(m.evidence, "Titles appear as they’re read.");
  assert.equal(m.action.enabled, false);
  assert.equal(m.action.reason, "A scan is running.");
  assert.equal(m.autoTarget, null);
  assert.equal(m.pollMs, 30_000);
  assert.equal(model(body(withScan({ state: "running", filesDone: 7, filesTotal: null }, { scannedAt: null }))).answer, "Scanning the library for the first time: 7 files read so far.");
});

test("scanning with data: ok chip, the normal answer, rescanning evidence", () => {
  const m = model(body(withScan({ state: "running", filesDone: 10, filesTotal: 2841 })));
  assert.deepEqual(m.chip, { tone: "ok", label: "Rescanning" });
  assert.equal(m.answer, "Movies and shows use 3.10 TB. 23 files could save about 640.0 GB.");
  assert.equal(m.evidence, "Rescanning: 10 of 2,841 files");
  assert.equal(m.action.enabled, false);
  assert.equal(m.pollMs, 30_000);
});

test("scan failed, with and without data: fixed words, Rescan on", () => {
  const w = model(body(withScan({ state: "failed", error: "EACCES /mnt/media/x on 10.0.0.5" })));
  assert.deepEqual(w.chip, { tone: "warn", label: "Scan failed" });
  assert.equal(w.answer, "The last scan failed. Showing the scan from 2 h ago.");
  assert.equal(w.evidence, "The worker’s log has the details.");
  assert.equal(w.action.enabled, true);
  assert.ok(!JSON.stringify(w).includes("EACCES"));
  const n = model(body(withScan({ state: "failed" }, { scannedAt: null, titles: [] })));
  assert.equal(n.answer, "The first scan failed. Rescan to try again.");
  assert.equal(n.strips.length, 0);
  assert.equal(n.action.enabled, true);
});

test("empty", () => {
  const m = model(body(lib({ titles: [], totals: { bytes: 0, files: 0, titles: 0, compressible: 0, estSavingBytes: 0 } })));
  assert.deepEqual(m.chip, { tone: "neutral", label: "Empty" });
  assert.equal(m.answer, "No movies or shows found in the media folders.");
  assert.equal(m.evidence, "Scanned 2 h ago · 0 files");
  assert.equal(m.action.enabled, true);
});

test("normal: ok Up to date, singular file, poll every 5 min, writes on", () => {
  const m = model();
  assert.deepEqual(m.chip, { tone: "ok", label: "Up to date" });
  assert.equal(m.answer, "Movies and shows use 3.10 TB. 23 files could save about 640.0 GB.");
  assert.equal(m.evidence, "Scanned 2 h ago · 2,841 files");
  assert.deepEqual(m.action, { shown: true, enabled: true, reason: null });
  assert.equal(m.notice, null);
  assert.equal(m.autoTarget, null);
  assert.equal(m.pollMs, 300_000);
  const one = model(body(lib({ totals: { ...lib().totals, compressible: 1 } })));
  assert.match(one.answer, /\. 1 file could save about/);
  assert.equal(model(body(lib({ totals: { ...lib().totals, bytes: 999.9 * GIB, compressible: 1, estSavingBytes: 999.9 * GIB } }))).answer.length <= 80, true);
});

test("nothing to compress", () => {
  const m = model(body(lib({ totals: { ...lib().totals, compressible: 0, estSavingBytes: 0, titles: 3 } })));
  assert.equal(m.chip.label, "Up to date");
  assert.equal(m.answer, "Movies and shows use 3.10 TB in 3 titles. Nothing needs compressing.");
});

test("stale: the dashboard's own fetch fails after a success", () => {
  const m = model({ body: undefined, loadError: true, last: { data: lib(), at: NOW - 3 * HOUR } });
  assert.deepEqual(m.chip, { tone: "neutral", label: "Stale" });
  assert.equal(m.answer, "Showing what was true 3 h ago. The dashboard isn’t getting answers.");
  assert.equal(m.notice, PAUSED);
  assert.equal(m.action.enabled, false);
  assert.equal(m.stale, true);
  assert.equal(m.strips.length, 3);
});

test("a fetch that fails before any success is the worker-down page, not a crash", () => {
  const m = model({ body: undefined, loadError: true, last: null });
  assert.equal(m.chip.label, "Worker down");
  assert.equal(m.strips.length, 0);
});

test("disk line, with held originals only when there are some", () => {
  assert.equal(model().disk, "Disk: 2.70 TB free of 7.28 TB");
  const held = lib({ disk: { sizeBytes: 8 * 1024 ** 4, freeBytes: 3 * 1024 ** 4, heldBytes: 7 * 1024 ** 3 } });
  assert.equal(model(body(held)).disk, "Disk: 3.00 TB free of 8.00 TB · 7.0 GB held for Undo");
  assert.equal(model().showFilter, true);
  assert.equal(model({ body: { worker: "unconfigured" }, last: null }).showFilter, false);
});

// ---- strips, filter, order ----
test("strips: one per title, largest first, state lines, tone null", () => {
  const m = model();
  assert.deepEqual(m.strips.map((s) => s.title), ["Big Film (2001)", "Bluey", "Tom & Jerry (1992)"]);
  assert.deepEqual(m.strips.map((s) => s.state), [
    "Movie · 40.0 GB · could save ~18.0 GB",
    "Show · 30.0 GB · 12 files · nothing to compress",
    "Movie · 5.0 GB · could save ~2.0 GB",
  ]);
  assert.ok(m.strips.every((s) => s.tone === null));
  const multi = model(body(lib({ titles: [{ ...title("Box", "movie", 9), files: 3 }] })));
  assert.equal(multi.strips[0].state, "Movie · 9.0 GB · 3 files · nothing to compress");
});

test("filter: counts and the rows each one keeps; the empty filter says so", () => {
  const m = model();
  assert.deepEqual(m.filterCounts, { all: 3, movie: 2, show: 1, save: 2 });
  assert.equal(model({ filter: "movie" }).strips.length, 2);
  assert.equal(model({ filter: "show" }).strips.length, 1);
  assert.equal(model({ filter: "save" }).strips.length, 2);
  const none = model({ filter: "save", ...body(lib({ titles: [title("A", "show", 5)] })) });
  assert.equal(none.strips.length, 0);
  assert.equal(none.filterEmpty, "No titles could save space.");
  assert.equal(model({ filter: "show", ...body(lib({ titles: [title("A", "movie", 5)] })) }).filterEmpty, "No shows.");
  assert.equal(model().filterEmpty, null);
});

// ---- C4 ids ----
test("strip ids are safe tokens, unique, and map back to the title id", () => {
  const names = ["Tom & Jerry (1992)", "It's #1", "A  B", "A B"];
  const titles = names.map((n) => title(n, "movie", 1));
  const m = model(body(lib({ titles })));
  const ids = m.strips.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
  assert.match(ids[0], /^movies-tom-jerry-1992-[a-z0-9]+$/);
  for (const t of titles) assert.equal(m.idOf[stripId(t.id)], t.id);
  assert.ok(ids.every((id) => !["server", "queue"].includes(id)));
  assert.ok(stripId("tv/" + "x".repeat(200)).length <= 40 + 1 + 7);
});

// ---- C15 order ----
test("order: first scan follows bytes; after it, a poll with the same scannedAt keeps the order", () => {
  const a = [title("Small", "movie", 1), title("Large", "movie", 9)];
  const first = model({ ...body(withScan({ state: "running" }, { scannedAt: null, titles: a })), prevOrder: null });
  assert.deepEqual(first.strips.map((s) => s.title), ["Large", "Small"]);
  const grown = [title("Small", "movie", 20), title("Large", "movie", 9)];
  const still = model({ ...body(withScan({ state: "running" }, { scannedAt: null, titles: grown })), prevOrder: first.order });
  assert.deepEqual(still.strips.map((s) => s.title), ["Small", "Large"]);

  const base = model({ ...body(lib({ titles: a })), prevOrder: null });
  const same = model({ ...body(lib({ titles: grown })), prevOrder: base.order });
  assert.deepEqual(same.strips.map((s) => s.title), ["Large", "Small"]);
  assert.equal(same.strips[1].state.includes("20.0 GB"), true);
  const newer = model({ ...body(lib({ titles: grown, scannedAt: new Date(NOW).toISOString() })), prevOrder: base.order });
  assert.deepEqual(newer.strips.map((s) => s.title), ["Small", "Large"]);
});

// ---- file rows ----
function file(o: { kbps?: number | null; source?: "stream" | "tag" | "estimated"; verdict?: MediaFile["verdict"]; hdr?: "HDR10" | null; tenBit?: boolean; interlaced?: boolean; probeError?: string; bytes?: number; codec?: string } = {}): MediaFile {
  return {
    path: "movies/Big Film (2001)/Big Film.mkv", name: "Big Film.mkv", bytes: o.bytes ?? 8.1 * GIB, mtimeMs: 0, nlink: 1, durationSec: 7200, container: "matroska",
    video: o.probeError ? null : { codec: o.codec ?? "h264", profile: null, width: 1920, height: 800, res: "1080p", kbps: o.kbps === undefined ? 8000 : o.kbps, kbpsSource: o.source ?? "stream", tenBit: o.tenBit ?? false, hdr: o.hdr ?? null, wideColour: false, interlaced: o.interlaced ?? false },
    videoStreams: 1, attachments: 0, audio: [], subs: [],
    verdict: o.verdict ?? { kind: "ok", ratio: null, reason: "Small file" },
    ...(o.probeError ? { probeError: o.probeError } : {}),
  };
}

test("file row: compress verdict line with the sweet spot and ratio", () => {
  const r = fileRow(file({ verdict: { kind: "compress", tune: null, ratio: 2.29, targetKbps: 3500, crf: 21, estSavingBytes: 4.6 * GIB, reason: "r" } }), "movie");
  assert.deepEqual(r.cells, { name: "Big Film.mkv", size: "8.1 GB", res: "1080p", codec: "h264", rate: "8.0 Mbit/s" });
  assert.equal(r.word, "Compress");
  assert.equal(r.line.facts, "1920×800");
  assert.equal(r.line.text, "saves ~4.6 GB (57%) at ~3.5 Mbit/s · sweet spot for 1080p film: 3.5 Mbit/s (2.3×)");
  assert.equal(r.act, null);
  assert.match(fileRow(file({ verdict: { kind: "compress", tune: null, ratio: 2, targetKbps: 2500, crf: 22, estSavingBytes: GIB, reason: "r" } }), "show").line.text, /sweet spot for 1080p TV: 4\.0 Mbit\/s \(2\.0×\)$/);
});

test("file row: ok with and without a ratio, skip, cant", () => {
  const ok = fileRow(file({ kbps: 3000, verdict: { kind: "ok", ratio: 0.86, reason: "Already under the sweet spot" } }), "movie");
  assert.equal(ok.word, "OK");
  assert.equal(ok.line.text, "Already under the sweet spot · sweet spot for 1080p film: 3.5 Mbit/s");
  assert.equal(fileRow(file({ verdict: { kind: "ok", ratio: null, reason: "Small file" } }), "movie").line.text, "Small file");
  const skip = fileRow(file({ hdr: "HDR10", tenBit: true, interlaced: true, verdict: { kind: "skip", reason: "HDR10" } }), "movie");
  assert.equal(skip.word, "Skipped");
  assert.equal(skip.line.facts, "1920×800 · HDR10 · 10-bit · Interlaced");
  assert.equal(skip.line.text, "HDR10");
  const cant = fileRow(file({ verdict: { kind: "cant", reason: "AVI can’t hold HEVC here" } }), "movie");
  assert.equal(cant.word, "Can’t compress");
  assert.equal(cant.line.text, "AVI can’t hold HEVC here");
});

test("file row: an estimated rate is marked, an unknown one is a dash, a probe error shows dashes", () => {
  assert.equal(fileRow(file({ source: "estimated" }), "movie").cells.rate, "~8.0 Mbit/s");
  assert.equal(fileRow(file({ kbps: null }), "movie").cells.rate, "—");
  const bad = fileRow(file({ probeError: "ffprobe said /mnt/media/x", verdict: { kind: "skip", reason: "Couldn’t read this file" } }), "movie");
  assert.deepEqual([bad.cells.res, bad.cells.codec, bad.cells.rate], ["—", "—", "—"]);
  assert.equal(bad.line.text, "Couldn’t read this file");
  assert.ok(!JSON.stringify(bad).includes("/mnt/"));
});

test("season head: size, files and the saving", () => {
  const files = [file({ bytes: 2 * GIB, verdict: { kind: "compress", tune: null, ratio: 2, targetKbps: 1, crf: 1, estSavingBytes: GIB, reason: "r" } }), file({ bytes: 3 * GIB })];
  assert.deepEqual(seasonHead({ name: "Season 01", bytes: 5 * GIB, files }), { name: "Season 01", right: "5.0 GB · 2 files · could save ~1.0 GB" });
  assert.equal(seasonHead({ name: "Season 02", bytes: GIB, files: [file()] }).right, "1.0 GB · 1 file · nothing to compress");
});

// M1: the fixtures must hold the worker's contract (a show's detail has seasons and no `files`), or the detail crashes.
import { FIXTURES } from "../../../scripts/fixtures/media/fixtures.mjs";
test("every fixture title detail matches the worker's shape and its rows build", () => {
  for (const fx of Object.values(FIXTURES) as { titles?: Record<string, any> }[]) {
    for (const d of Object.values(fx.titles ?? {})) {
      if (d.kind === "show") assert.equal(d.files, undefined, `${d.id}: a show detail has no files`);
      const files = d.files ?? d.seasons.flatMap((s: any) => s.files);
      assert.ok(Array.isArray(files), d.id);
      for (const s of d.seasons ?? []) seasonHead(s);
      for (const f of files) fileRow(f, d.kind);
    }
  }
});

// ---- skipped entries (nw-media-skipped) ----
const SKIP_ONE = "1 file or folder couldn’t be read in the last scan.";
const SKIP_MANY = (n: number) => `${n} files or folders couldn’t be read in the last scan.`;

test("skipped: an idle scan that read everything shows no notice", () => {
  assert.equal(model(body(withScan({ state: "idle", skipped: 0 }))).notice, null);
});
test("skipped: idle with 1 gives the singular", () => {
  assert.equal(model(body(withScan({ state: "idle", skipped: 1 }))).notice, SKIP_ONE);
});
test("skipped: idle with 3 gives the plural", () => {
  assert.equal(model(body(withScan({ state: "idle", skipped: 3 }))).notice, SKIP_MANY(3));
});
test("skipped: a running scan shows none", () => {
  assert.equal(model(body(withScan({ state: "running", skipped: 2 }))).notice, null);
});
test("skipped: a failed scan shows none", () => {
  assert.equal(model(body(withScan({ state: "failed", skipped: 2 }))).notice, null);
});
test("skipped: worker down keeps PAUSED", () => {
  const m = model({ body: { worker: "unreachable" }, last: { data: withScan({ skipped: 2 }), at: NOW - 2 * HOUR } });
  assert.equal(m.notice, PAUSED);
});

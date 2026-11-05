import assert from "node:assert/strict";
import { test } from "node:test";
import type { Job, JobsResponse, LibraryResponse, MediaFile } from "../../../services/media-worker/src/types.ts";
import { batchPlan, compressSay, suggestedFiles, titleSummary, dayLabel, etaText, failedWords, fileRow, jobText, mediaModel, rowJobs, type ModelInput } from "./page-model.ts";

const NOW = Date.parse("2026-11-05T09:30:00Z");
const GIB = 1024 ** 3;
const AT = new Date(NOW - 7_200_000).toISOString();

const lib = (): LibraryResponse => ({
  scan: { state: "idle", startedAt: AT, finishedAt: AT, filesDone: 0, filesTotal: null, skipped: 0 },
  scannedAt: AT,
  totals: { bytes: 90 * GIB, files: 3, titles: 1, compressible: 1, estSavingBytes: 4 * GIB },
  disk: { sizeBytes: 500 * GIB, freeBytes: 200 * GIB, heldBytes: 0 },
  titles: [{ id: "movies/Big Film (2001)", kind: "movie", name: "Big Film (2001)", bytes: 9 * GIB, files: 1, compressible: 1, estSavingBytes: 4 * GIB }],
});
const file = (job?: MediaFile["job"], over: Partial<MediaFile> = {}): MediaFile => ({
  path: "movies/Big Film (2001)/Big Film.mkv", name: "Big Film.mkv", bytes: 9 * GIB, mtimeMs: 0, nlink: 1, durationSec: 7200, container: "matroska",
  video: { codec: "h264", profile: null, width: 1920, height: 1080, res: "1080p", kbps: 8000, kbpsSource: "stream", tenBit: false, hdr: null, wideColour: false, interlaced: false },
  videoStreams: 1, attachments: 0, audio: [], subs: [],
  verdict: { kind: "compress", ratio: 2.3, targetKbps: 3500, crf: 21, estSavingBytes: 4 * GIB, reason: "r" },
  ...(job ? { job } : {}),
  ...over,
});
const job = (state: Job["state"], over: Partial<Job> = {}): Job => ({
  id: "job-abcdef12", path: "movies/Big Film (2001)/Big Film.mkv", state, createdAt: AT, crf: 21, sourceBytes: 9 * GIB, attempts: 0, ...over,
});
const jobs = (o: Partial<JobsResponse> = {}): JobsResponse => ({ compressEnabled: true, compressReady: true, current: null, queue: [], recent: [], ...o });
const row = (j: Job | null, over: Partial<JobsResponse> = {}, f = file(j ? { id: j.id, state: j.state } : undefined)) =>
  fileRow(f, "movie", rowJobs(jobs({ ...over, ...(j ? { recent: [j] } : {}) })));
const DONE = job("done", { outputBytes: 4 * GIB, heldUntil: "2026-11-12T00:00:00.000Z", jellyfin: "told" });

test("row: compress ready gives a Compress action with the question text", () => {
  const r = row(null);
  assert.equal(r.word, "Compress");
  assert.equal(r.act?.kind, "compress");
  assert.equal(
    compressSay(file()),
    "Compresses Big Film.mkv from 9.0 GB to about 5.0 GB (about 44% smaller) at about 3.5 Mbit/s. The original is kept for 7 days after it’s done; Undo puts it back.",
  );
});

test("row: Compress off until calibration is dim, with the reason and no action", () => {
  const r = row(null, { compressEnabled: false, compressReady: false });
  assert.equal(r.word, "Compress");
  assert.equal(r.tone, "dim");
  assert.match(r.line.text, / · Compress turns on after calibration$/);
  assert.equal(r.act, null);
});

test("row: not ready says why and has no action", () => {
  const r = row(null, { compressReady: false, reason: "Hold folder missing or not writable" });
  assert.equal(r.word, "Compress");
  assert.equal(r.line.text, "Compress is unavailable: Hold folder missing or not writable");
  assert.equal(r.act, null);
});

test("row: a plain OK file is unchanged by the jobs answer", () => {
  const f = file(undefined, { verdict: { kind: "ok", ratio: null, reason: "Small file" } });
  assert.deepEqual(fileRow(f, "movie", rowJobs(jobs())), fileRow(f, "movie"));
});

test("row: queued says how many are ahead, 'next' when none, and cancels without a question", () => {
  const a = job("queued", { id: "job-aaaaaaaa", path: "movies/A/A.mkv" });
  const b = job("queued");
  const j = jobs({ queue: [a, b] });
  const r = fileRow(file({ id: b.id, state: "queued" }), "movie", rowJobs(j));
  assert.deepEqual([r.word, r.line.text], ["Queued", "1 ahead"]);
  assert.deepEqual(r.act, { kind: "cancel", id: b.id, name: "Big Film.mkv", confirm: false });
  const first = fileRow(file({ id: a.id, state: "queued" }), "movie", rowJobs(j));
  assert.equal(first.line.text, "next");
});

test("row: encoding shows percent, fps and eta, with Cancel behind a question", () => {
  const e = job("encoding", { progress: { pct: 42.2, fps: 31.4, etaSec: 4800 } });
  const r = fileRow(file({ id: e.id, state: "encoding" }), "movie", rowJobs(jobs({ current: e })));
  assert.deepEqual([r.word, r.line.text, r.tone], ["Compressing", "42% · 31 fps · about 1 h 20 min left", "active"]);
  assert.equal(r.act?.kind === "cancel" && r.act.confirm, true);
});

test("row: verifying and swapping", () => {
  const v = job("verifying");
  const rv = fileRow(file({ id: v.id, state: "verifying" }), "movie", rowJobs(jobs({ current: v })));
  assert.deepEqual([rv.word, rv.line.text, rv.act?.kind], ["Checking", "Checking the new file…", "cancel"]);
  const s = job("swapping");
  const rs = fileRow(file({ id: s.id, state: "swapping" }), "movie", rowJobs(jobs({ current: s })));
  assert.deepEqual([rs.word, rs.line.text, rs.act], ["Swapping", "Swapping in the new file…", null]);
});

test("row: done and held shows the saving and the date, with Undo", () => {
  const r = row(DONE);
  assert.deepEqual([r.word, r.line.text, r.act?.kind], ["Compressed", "Saved 5.0 GB. Original kept until 12 Nov.", "undo"]);
});

test("row: done with Jellyfin off or failed adds the next-scan note", () => {
  for (const jellyfin of ["off", "failed"] as const) {
    assert.match(row({ ...DONE, jellyfin }).line.text, /Original kept until 12 Nov\. Jellyfin will pick up the change at its next library scan\.$/);
  }
});

test("row: a file with an earlier done job reads as already compressed, with Undo (S9)", () => {
  const r = row(DONE, {}, file({ id: DONE.id, state: "done" }, { verdict: { kind: "compress", ratio: 2, targetKbps: 1, crf: 21, estSavingBytes: GIB, reason: "r" } }));
  assert.equal(r.word, "Compressed");
  assert.equal(r.act?.kind, "undo");
});

test("row: undone is Restored with no action", () => {
  const r = row(job("undone"));
  assert.deepEqual([r.word, r.line.text, r.act], ["Restored", "Original restored.", null]);
});

test("row: a failed check keeps the original, with Try again; Dismiss goes back to the verdict", () => {
  const f = job("failed", { failedCheck: "saving", failedValue: 4 });
  const r = row(f);
  assert.deepEqual([r.word, r.line.text, r.act?.kind, r.tone], ["Failed", "Kept the original: it saved only 4%.", "retry", "bad"]);
  const back = fileRow(file({ id: f.id, state: "failed" }), "movie", rowJobs(jobs({ recent: [f] })), { dismissed: true });
  assert.equal(back.word, "Compress");
  assert.equal(back.act?.kind, "compress");
});

test("row: cancelled and purged", () => {
  const c = row(job("cancelled"));
  assert.deepEqual([c.word, c.line.text, c.act], ["Cancelled", "Cancelled. The original is unchanged.", null]);
  const p = row(job("purged", { outputBytes: 4 * GIB, heldUntil: "2026-11-12T00:00:00.000Z" }));
  assert.deepEqual([p.word, p.line.text, p.act], ["Compressed", "Saved 5.0 GB. Original deleted 12 Nov.", null]);
});

test("row: a job past the worker's recent list still shows its state", () => {
  const r = fileRow(file({ id: "gone-job-00000", state: "done" }), "movie", rowJobs(jobs()));
  assert.deepEqual([r.word, r.act?.kind], ["Compressed", "undo"]);
});

test("every failed check has plain words", () => {
  const checks = ["probe", "duration", "streams", "decode", "frames", "saving", "source-changed", "disk", "restart", "encoder", "swap"] as const;
  for (const c of checks) assert.match(failedWords({ failedCheck: c, failedValue: 3 }), /^[a-z]/, c);
  assert.equal(failedWords({ failedCheck: "duration", failedValue: 3 }), "the new file is 3 s shorter");
  assert.equal(failedWords({ failedCheck: "source-changed" }), "the source file changed during compression");
  assert.equal(failedWords({}), "something went wrong");
});

test("dates are Sydney days and times read like 'about 1 h 20 min'", () => {
  assert.equal(dayLabel("2026-11-11T23:00:00.000Z"), "12 Nov");
  assert.deepEqual([etaText(30), etaText(600), etaText(4800)], ["30 s", "10 min", "1 h 20 min"]);
  assert.equal(jobText(job("queued"), 2).line, "2 ahead");
});

// ---- head, queue strip, Cancel all ----
const input = (j: JobsResponse | null, o: Partial<ModelInput> = {}): ModelInput => ({
  body: { worker: "ok", data: lib() }, loadError: false, last: { data: lib(), at: NOW }, filter: "all", prevOrder: null, now: NOW, jobs: j, ...o,
});
const queued = (n: number) => Array.from({ length: n }, (_, i) => job("queued", { id: `job-queued-${i}`, path: `movies/Q${i}/Q${i}.mkv` }));

test("head: no jobs answer leaves the model as it was", () => {
  const m = mediaModel(input(null));
  assert.equal(m.queue, null);
  assert.equal(m.strips.some((s) => s.id === "queue"), false);
  assert.equal(m.chip.label, "Up to date");
});

test("head: encoding gives the Compressing chip, the answer, the queued count and opens the queue strip", () => {
  const e = job("encoding", { progress: { pct: 42, fps: 30, etaSec: 100 } });
  const m = mediaModel(input(jobs({ current: e, queue: queued(2) })));
  assert.deepEqual(m.chip, { tone: "ok", label: "Compressing" });
  assert.equal(m.answer, "Compressing Big Film.mkv: 42%. 2 more queued.");
  assert.match(m.evidence, / · 2 queued$/);
  assert.equal(m.autoTarget, "queue");
  assert.equal(m.strips[0].id, "queue");
  assert.equal(m.strips[0].title, "Compress queue");
  assert.equal(m.strips[0].state, "Compressing Big Film.mkv · 42%");
  assert.equal(m.queue?.current?.pct, 42);
  assert.equal(m.queue?.queued.length, 2);
});

test("head: queued with Compress not ready gives the warn chip", () => {
  const m = mediaModel(input(jobs({ queue: queued(1), compressReady: false, reason: "Hold folder missing or not writable" })));
  assert.deepEqual(m.chip, { tone: "warn", label: "Compress unavailable" });
  assert.equal(m.strips[0].state, "1 queued");
});

test("queue strip: last, and only when there is history or Compress is off", () => {
  const idle = mediaModel(input(jobs()));
  assert.equal(idle.strips.some((s) => s.id === "queue"), false);
  const done = mediaModel(input(jobs({ recent: [DONE] })));
  assert.equal(done.strips.at(-1)?.id, "queue");
  assert.equal(done.strips.at(-1)?.state, "Nothing queued · last saved 5.0 GB");
  const off = mediaModel(input(jobs({ compressEnabled: false, compressReady: false })));
  assert.equal(off.strips.at(-1)?.state, "Off until calibration");
  assert.equal(off.chip.label, "Up to date");
});

test("Cancel all appears with two or more jobs and names what it stops", () => {
  const e = job("encoding", { progress: { pct: 5, fps: 30, etaSec: 100 } });
  assert.equal(mediaModel(input(jobs({ queue: queued(1) }))).cancelAll, null);
  const m = mediaModel(input(jobs({ current: e, queue: queued(2) })));
  assert.equal(m.cancelAll?.say, "Stops compressing Big Film.mkv and removes 2 queued files. Every original stays as it is.");
  assert.equal(m.cancelAll?.ids.length, 3);
  assert.equal(mediaModel(input(jobs({ queue: queued(2) }))).cancelAll?.say, "Removes 2 queued files. Every original stays as it is.");
});

test("stale or down: the jobs answer is ignored", () => {
  const m = mediaModel(input(jobs({ queue: queued(2) }), { body: { worker: "unreachable" } }));
  assert.equal(m.queue, null);
  assert.equal(m.cancelAll, null);
});

// ---- the batch button ----
test("batch: counts suggested files, skips those already queued or done, caps at 200", () => {
  const files = [
    file(undefined, { path: "tv/S/a.mkv", name: "a.mkv" }),
    file(undefined, { path: "tv/S/b.mkv", name: "b.mkv", verdict: { kind: "compress", ratio: 2, targetKbps: 1, crf: 21, estSavingBytes: 6 * GIB, reason: "r" } }),
    file({ id: "x", state: "queued" }, { path: "tv/S/c.mkv", name: "c.mkv" }),
    file(undefined, { path: "tv/S/d.mkv", name: "d.mkv", verdict: { kind: "ok", ratio: null, reason: "Small file" } }),
  ];
  const p = batchPlan(files);
  assert.equal(p?.label, "Compress 2 suggested");
  assert.deepEqual(p?.paths, ["tv/S/b.mkv", "tv/S/a.mkv"]);
  assert.equal(p?.yes, "Yes, compress 2");
  assert.equal(p?.flight, "Adding 2 files…");
  assert.equal(p?.say, "Compresses 2 files from 18.0 GB to about 8.0 GB (saves about 10.0 GB). They run one at a time; each original is kept for 7 days after it’s done, and Undo puts it back.");
  const many = Array.from({ length: 201 }, (_, i) => file(undefined, { path: `tv/S/${i}.mkv`, name: `${i}.mkv` }));
  const big = batchPlan(many);
  assert.equal(big?.label, "Compress the 200 largest");
  assert.equal(big?.paths.length, 200);
  assert.equal(batchPlan([files[3]]), null);
});

test("F3: the summary row reads \"1 file · could save\" for one file, \"3 files · 2 could save\" for three", () => {
  assert.equal(titleSummary([file()]), "1 file · could save ~4.0 GB");
  const ok = file(undefined, { path: "tv/S/o.mkv", verdict: { kind: "ok", ratio: null, reason: "Small file" } });
  assert.equal(titleSummary([file(), file(undefined, { path: "tv/S/b.mkv" }), ok]), "3 files · 2 could save ~8.0 GB");
  assert.equal(titleSummary([ok]), "1 file · nothing to compress");
});

test("F8/S9: files whose job is done, held or purged are not suggested, in the summary or the batch", () => {
  const files = [file(), file({ id: "d", state: "done" }, { path: "a" }), file({ id: "p", state: "purged" }, { path: "b" }), file({ id: "f", state: "failed" }, { path: "c" })];
  assert.deepEqual(suggestedFiles(files).map((f) => f.path), [files[0].path, "c"]);
  assert.equal(titleSummary(files), "4 files · 2 could save ~8.0 GB");
  assert.equal(batchPlan([files[1], files[2]]), null);
});

import assert from "node:assert/strict";
import { linkSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { FileStat } from "./probe.ts";
import { thresholds } from "./sweet-spot.ts";
import { SKIP_OFF_LINUX, start, tempDir, type Started } from "./testkit.ts";
import type { Health, JobsResponse, TitleDetail } from "./types.ts";
import type { VerdictInput } from "./verdict.ts";

const GB = 2 ** 30;
// durationSec 1, not 3600: a 900 KB fixture at 12000 kbps for an hour estimates no saving, so the verdict is "Saving too small" (409).
const probe = async (_abs: string, st: FileStat): Promise<VerdictInput> => ({
  ...st, durationSec: 1, container: "matroska", videoStreams: 1, attachments: 0, audio: [{ codec: "aac", channels: 2, lang: "eng" }],
  subs: [], video: { codec: "h264", profile: null, width: 1920, height: 1080, res: "1080p", kbps: st.name.startsWith("Lean") ? 1000 : 12000,
    kbpsSource: "stream", tenBit: false, hdr: null, wideColour: false, interlaced: false },
});
const plenty = () => ({ bavail: (500 * GB) / 4096, bsize: 4096 });

describe("D9: test thresholds are opt-in", () => {
  it("unset and '0' mean the real 500 MB floors; only '1' scales them", () => {
    assert.equal(thresholds({}).MIN_FILE_BYTES, 500 * 1024 * 1024);
    assert.equal(thresholds({ MEDIA_WORKER_TEST_THRESHOLDS: "0" }).MIN_SAVING_BYTES, 500 * 1024 * 1024);
    assert.equal(thresholds({ MEDIA_WORKER_TEST_THRESHOLDS: "1" }).MIN_FILE_BYTES, 500);
  });
});

describe("jobs api (B8)", () => {
  let s: Started;
  let root: string;
  const setup = async (env: Record<string, string>, nightwatch: boolean) => {
    root = tempDir("mw-jobs-api-");
    for (const rel of ["movies/Big Film (2015)/Big Film.mkv", "movies/Lean Film (2015)/Lean Film.mkv", "movies/Linked (2016)/Linked.mkv", "music/Decoy/decoy.mkv"]) {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), Buffer.alloc(900_000));
    }
    linkSync(join(root, "movies/Linked (2016)/Linked.mkv"), join(root, "movies/Linked (2016)/Linked copy.mkv"));
    mkdirSync(join(root, "tv"));
    if (nightwatch) mkdirSync(join(root, ".nightwatch"));
    s = await start({ mediaRoot: root, probe, prefix: [], statfs: plenty, env: { MEDIA_WORKER_TEST_THRESHOLDS: "1", ...env } });
    await fetch(`${s.base}/scan`, { method: "POST", headers: s.auth });
    await s.r.scanner.whenIdle();
  };
  afterEach(async () => { await s.stop(); rmSync(root, { recursive: true, force: true }); });

  const post = (path: string, body?: unknown) =>
    fetch(`${s.base}${path}`, { method: "POST", headers: { ...s.auth, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const get = (path: string) => fetch(`${s.base}${path}`, { headers: s.auth });

  beforeEach(() => undefined);

  it("Compress unset: /health says off, GET /jobs is empty, POST /jobs is a 409 'off until calibration'", async () => {
    await setup({}, true);
    const h = (await (await fetch(`${s.base}/health`)).json()) as Health;
    assert.deepEqual([h.compressEnabled, h.compressReady], [false, false]);
    const jobs = (await (await get("/jobs")).json()) as JobsResponse;
    assert.deepEqual([jobs.compressEnabled, jobs.current, jobs.queue, jobs.recent], [false, null, [], []]);
    const r = await post("/jobs", { path: "movies/Big Film (2015)/Big Film.mkv" });
    assert.equal(r.status, 409);
    assert.match(((await r.json()) as { error: string }).error, /off until calibration/);
  });

  it("enabled with no .nightwatch folder: not ready, with the reason (S5)", async () => {
    await setup({ MEDIA_COMPRESS_ENABLED: "1" }, false);
    const h = (await (await fetch(`${s.base}/health`)).json()) as Health;
    assert.deepEqual([h.compressEnabled, h.compressReady, h.reason], [true, false, "Hold folder missing or not writable"]);
    assert.equal((await post("/jobs", { path: "movies/Big Film (2015)/Big Film.mkv" })).status, 409);
  });

  it("a path outside movies/ and tv/ is a 400; a body that is not JSON is a 400; an unknown job is a 404", async () => {
    await setup({ MEDIA_COMPRESS_ENABLED: "1" }, true);
    assert.equal((await post("/jobs", { path: "music/Decoy/decoy.mkv" })).status, 400);
    assert.equal((await fetch(`${s.base}/jobs`, { method: "POST", headers: s.auth, body: "{nope" })).status, 400);
    assert.equal((await post("/jobs/abcdef123456/cancel")).status, 404);
    assert.equal((await post("/jobs/abcdef123456/undo")).status, 404);
  });

  it("a lean file and a hardlinked file are 409 'not compressible'", { skip: SKIP_OFF_LINUX }, async () => {
    await setup({ MEDIA_COMPRESS_ENABLED: "1" }, true);
    for (const path of ["movies/Lean Film (2015)/Lean Film.mkv", "movies/Linked (2016)/Linked.mkv"]) {
      const r = await post("/jobs", { path });
      assert.equal(r.status, 409, path);
      assert.match(((await r.json()) as { error: string }).error, /not compressible/i);
    }
  });

  it("a compressible file is accepted (201); it can't be queued twice; file.job shows in /title", { skip: SKIP_OFF_LINUX }, async () => {
    await setup({ MEDIA_COMPRESS_ENABLED: "1" }, true);
    const path = "movies/Big Film (2015)/Big Film.mkv";
    const r = await post("/jobs", { path });
    assert.equal(r.status, 201);
    const job = (await r.json()) as { id: string; path: string };
    assert.match(job.id, /^[a-z0-9-]{8,40}$/);
    assert.equal(JSON.stringify(job).includes(root), false);
    assert.equal((await post("/jobs", { path })).status, 409);
    const t = (await (await get(`/title?id=${encodeURIComponent("movies/Big Film (2015)")}`)).json()) as TitleDetail;
    const f = t.files?.[0] ?? t.seasons?.[0]?.files[0];
    assert.equal(f?.job?.id, job.id);
    assert.equal((await post("/jobs/batch/b-unknown/cancel")).status, 404);
  });
});

import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { FileStat } from "./probe.ts";
import { SKIP_OFF_LINUX, start, tempDir, type Started } from "./testkit.ts";
import type { LibraryResponse, ScanState, TitleDetail } from "./types.ts";
import type { VerdictInput } from "./verdict.ts";

const probe = async (_abs: string, st: FileStat): Promise<VerdictInput> => ({
  ...st, durationSec: 1, container: "matroska", videoStreams: 1, attachments: 0, audio: [{ codec: "aac", channels: 2, lang: "eng" }],
  subs: [], video: { codec: "h264", profile: null, width: 1920, height: 1080, res: "1080p", kbps: 100000, kbpsSource: "stream",
    tenBit: false, hdr: null, wideColour: false, interlaced: false },
});

describe("worker api", { skip: SKIP_OFF_LINUX }, () => {
  let s: Started;
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = tempDir("mw-api-"); outside = tempDir("mw-out-");
    for (const [rel, n] of [["movies/Alien (1979)/Alien.mkv", 900_000], ["tv/Bluey/Season 01/e1.mkv", 600_000], ["music/a.mkv", 5]] as const) {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), Buffer.alloc(n));
    }
    writeFileSync(join(outside, "secret.mkv"), "x");
    symlinkSync(outside, join(root, "movies/Escape"));
    s = await start({ mediaRoot: root, probe, env: { MEDIA_WORKER_TEST_THRESHOLDS: "1" } });
    await fetch(`${s.base}/scan`, { method: "POST", headers: s.auth });
    await s.r.scanner.whenIdle();
  });
  afterEach(async () => {
    await s.stop();
    for (const d of [root, outside]) rmSync(d, { recursive: true, force: true });
  });

  const get = (path: string) => fetch(`${s.base}${path}`, { headers: s.auth });

  it("GET /library has the contract shape, sorted by bytes", async () => {
    const res = await get("/library");
    assert.equal(res.status, 200);
    const l = (await res.json()) as LibraryResponse;
    assert.deepEqual(Object.keys(l).sort(), ["disk", "scan", "scannedAt", "titles", "totals"]);
    assert.equal(l.scan.state, "idle");
    assert.equal(l.scan.skipped, 0);
    assert.ok(l.scannedAt);
    assert.deepEqual(l.titles.map((t) => [t.id, t.kind, t.files]), [["movies/Alien (1979)", "movie", 1], ["tv/Bluey", "show", 1]]);
    assert.deepEqual(Object.keys(l.titles[0]).sort(), ["bytes", "compressible", "estSavingBytes", "files", "id", "kind", "name"]);
    assert.equal(l.totals.titles, 2);
    assert.equal(l.totals.bytes, 1_500_000);
    assert.equal(typeof l.disk.freeBytes, "number");
    assert.equal(l.disk.heldBytes, 0);
  });

  it("GET /title returns a movie's files and a show's seasons", async () => {
    const movie = (await (await get(`/title?id=${encodeURIComponent("movies/Alien (1979)")}`)).json()) as TitleDetail;
    assert.equal(movie.files!.length, 1);
    assert.equal(movie.files![0].path, "movies/Alien (1979)/Alien.mkv");
    assert.equal(movie.files![0].verdict.kind, "compress");
    const show = (await (await get("/title?id=tv/Bluey")).json()) as TitleDetail;
    assert.deepEqual(show.seasons!.map((x) => x.name), ["Season 01"]);
  });

  it("GET /title: 400 for a bad id, 404 for an unknown one", async () => {
    for (const id of ["../etc/passwd", "/etc/passwd", "music/a.mkv", "movies/../music", "movies/.nightwatch", "movies\\x", ""]) {
      assert.equal((await get(`/title?id=${encodeURIComponent(id)}`)).status, 400, id);
    }
    assert.equal((await get("/title")).status, 400);
    assert.equal((await get("/title?id=movies/Escape")).status, 400);
    assert.equal((await get("/title?id=movies/Escape/secret.mkv")).status, 400);
    assert.equal((await get("/title?id=movies/%252e%252e/x")).status, 404);
    assert.equal((await get("/title?id=movies")).status, 404);
    assert.equal((await get("/title?id=tv/Nope")).status, 404);
  });

  it("POST /scan is 202 with a ScanState, and unknown routes are 404", async () => {
    const res = await fetch(`${s.base}/scan`, { method: "POST", headers: s.auth, body: "{}" });
    assert.equal(res.status, 202);
    const st = (await res.json()) as ScanState;
    assert.ok(["running", "idle"].includes(st.state));
    await s.r.scanner.whenIdle();
    assert.equal((await get("/nope")).status, 404);
    assert.equal((await fetch(`${s.base}/scan`, { method: "POST", headers: s.auth, body: "{not json" })).status, 400);
    assert.equal((await fetch(`${s.base}/library`, { method: "POST", headers: s.auth })).status, 404);
  });

  it("logs the scaled thresholds loudly at boot, without the token", async () => {
    assert.match(s.logs.join("\n"), /TEST THRESHOLDS ON/);
    assert.doesNotMatch(s.logs.join("\n"), /test-token/);
  });
});

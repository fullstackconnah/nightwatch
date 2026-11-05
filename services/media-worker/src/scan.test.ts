import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { buildLibrary, titleDetail } from "./library.ts";
import type { FileStat } from "./probe.ts";
import { createScanner, nextRunAt, scheduleNightly, type ScannerOpts } from "./scan.ts";
import { SKIP_OFF_LINUX, start, tempDir, type Started } from "./testkit.ts";
import type { VerdictInput } from "./verdict.ts";

const ENV = { MEDIA_WORKER_TEST_THRESHOLDS: "1" };

/** A probe stub: counts calls and returns a high-bitrate h264 file, so every video compresses at test scale. */
function stubProbe(counter: { calls: string[] }, gate?: (path: string) => Promise<void> | undefined) {
  return async (_abs: string, st: FileStat): Promise<VerdictInput> => {
    counter.calls.push(st.path);
    await gate?.(st.path);
    return {
      ...st, durationSec: 1, container: "matroska", videoStreams: 1, attachments: 0, audio: [], subs: [],
      video: { codec: "h264", profile: null, width: 1920, height: 1080, res: "1080p", kbps: 100000, kbpsSource: "stream",
        tenBit: false, hdr: null, wideColour: false, interlaced: false },
    };
  };
}

function put(root: string, rel: string, bytes: number) {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, Buffer.alloc(bytes));
}

/** The plan's tree. Show (2.4 MB) > A (2.0 MB) > Loose (1.0 MB). */
function makeTree(root: string, outside: string) {
  put(root, "movies/A (1999)/A.mkv", 2_000_000);
  put(root, "movies/A (1999)/A.srt", 9_000_000);
  put(root, "movies/Loose.mp4", 1_000_000);
  put(root, "tv/Show/Season 01/e1.mkv", 600_000);
  put(root, "tv/Show/Season 01/e2.mkv", 600_000);
  put(root, "tv/Show/Season 02/e1.mkv", 600_000);
  put(root, "tv/Show/extra.mkv", 600_000);
  put(root, "music/x.mkv", 500_000);
  put(root, "movies/.nightwatch/x.mkv", 500_000);
  put(outside, "linked.mkv", 500_000);
  symlinkSync(outside, join(root, "movies/Link"));
}

describe("scan", { skip: SKIP_OFF_LINUX }, () => {
  let root: string;
  let outside: string;
  let stateDir: string;
  const counter = { calls: [] as string[] };
  const scanner = (over: Partial<ScannerOpts> = {}) =>
    createScanner({ mediaRoot: root, stateDir, probe: stubProbe(counter), env: ENV, ...over });
  const scan = async (s: ReturnType<typeof scanner>) => { assert.equal(s.start(), true); await s.whenIdle(); };

  beforeEach(() => {
    root = tempDir("mw-scan-"); outside = tempDir("mw-out-"); stateDir = tempDir("mw-st-");
    counter.calls = [];
    makeTree(root, outside);
  });
  afterEach(() => { for (const d of [root, outside, stateDir]) rmSync(d, { recursive: true, force: true }); });

  const lib = (s: ReturnType<typeof scanner>) => buildLibrary(s.files(), s.state(), s.scannedAt(), { sizeBytes: 0, freeBytes: 0, heldBytes: 0 });

  it("lists 3 titles by bytes, with seasons and Other, ignoring the srt", async () => {
    const s = scanner();
    await scan(s);
    const l = lib(s);
    assert.deepEqual(l.titles.map((t) => [t.id, t.kind, t.bytes]), [
      ["tv/Show", "show", 2_400_000], ["movies/A (1999)", "movie", 2_000_000], ["movies/Loose.mp4", "movie", 1_000_000],
    ]);
    assert.equal(l.titles[2].name, "Loose");
    assert.equal(l.totals.files, 6);
    assert.equal(l.totals.compressible, 6);
    const show = titleDetail(s.files(), "tv/Show")!;
    assert.deepEqual(show.seasons!.map((x) => [x.name, x.files.length]), [["Season 01", 2], ["Season 02", 1], ["Other", 1]]);
    assert.equal(titleDetail(s.files(), "movies/A (1999)")!.files!.length, 1);
    assert.equal(titleDetail(s.files(), "movies/Nope"), null);
  });

  it("never lists music, dot folders or symlinks", async () => {
    const s = scanner();
    await scan(s);
    const paths = Object.keys(s.files());
    assert.ok(paths.every((p) => /^(movies|tv)\//.test(p)));
    assert.ok(!paths.some((p) => p.includes("music") || p.includes(".nightwatch") || p.includes("Link") || p.includes("linked")));
  });

  it("re-probes only what changed, and drops what is gone", async () => {
    const s = scanner();
    await scan(s);
    assert.equal(counter.calls.length, 6);

    counter.calls = [];
    await scan(s);
    assert.equal(counter.calls.length, 0);

    const e1 = join(root, "tv/Show/Season 01/e1.mkv");
    writeFileSync(e1, Buffer.alloc(700_000));
    counter.calls = [];
    await scan(s);
    assert.deepEqual(counter.calls, ["tv/Show/Season 01/e1.mkv"]);

    rmSync(join(root, "movies/Loose.mp4"));
    await scan(s);
    assert.ok(!lib(s).titles.some((t) => t.name === "Loose"));
  });

  it("re-probes a file whose mtime alone changed", async () => {
    const s = scanner();
    await scan(s);
    counter.calls = [];
    utimesSync(join(root, "movies/Loose.mp4"), new Date(), new Date(Date.now() + 60_000));
    await scan(s);
    assert.deepEqual(counter.calls, ["movies/Loose.mp4"]);
  });

  it("survives a reload from scan.json", async () => {
    const s = scanner();
    await scan(s);
    const s2 = scanner();
    assert.deepEqual(Object.keys(s2.files()).sort(), Object.keys(s.files()).sort());
    assert.equal(s2.scannedAt(), s.scannedAt());
    assert.equal(s2.needsBootScan(), false);
    assert.equal(scanner({ now: () => new Date(Date.now() + 25 * 3600_000) }).needsBootScan(), true);
    assert.equal(createScanner({ mediaRoot: root, stateDir: tempDir(), probe: stubProbe(counter) }).needsBootScan(), true);
  });

  it("flushes every 200 probes, so a crash keeps that work", async () => {
    for (let i = 0; i < 450; i++) put(root, `movies/Bulk/f${String(i).padStart(3, "0")}.mkv`, 1000);
    let release!: () => void;
    const hang = new Promise<void>((r) => { release = r; });
    let n = 0;
    const s = scanner({ probe: (abs, st) => (++n > 200 ? hang.then(() => stubProbe(counter)(abs, st)) : stubProbe(counter)(abs, st)) });
    assert.equal(s.start(), true);
    const file = join(stateDir, "scan.json");
    for (let i = 0; i < 100 && !(existsSync(file) && n >= 202); i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(Object.keys(JSON.parse(readFileSync(file, "utf8")).files).length, 200);
    release();
    await s.whenIdle();
  });

  it("skips and counts an entry that cannot be read (lstat or probe error)", async () => {
    const s = scanner({
      lstat: async (p) => { if (p.endsWith("Loose.mp4")) throw new Error("EIO"); return statSync(p); },
      probe: async (abs, st) => { if (st.path.endsWith("extra.mkv")) throw new Error("boom"); return stubProbe(counter)(abs, st); },
    });
    await scan(s);
    assert.equal(s.state().state, "idle");
    assert.equal(s.state().skipped, 2);
    assert.equal(Object.keys(s.files()).length, 4);
  });

  it("never writes under the media root", async () => {
    const snap = () => {
      const out: string[] = [];
      const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          out.push(`${p}:${e.isDirectory() ? "d" : statSync(p).size + "@" + statSync(p).mtimeMs}`);
          if (e.isDirectory()) walk(p);
        }
      };
      walk(root);
      return out.sort();
    };
    const before = snap();
    await scan(scanner());
    assert.deepEqual(snap(), before);
    assert.ok(existsSync(join(stateDir, "scan.json")));
  });
});

describe("scan over http", { skip: SKIP_OFF_LINUX }, () => {
  let s: Started | undefined;
  let root: string;
  let outside: string;
  afterEach(async () => {
    await s?.stop(); s = undefined;
    for (const d of [root, outside]) rmSync(d, { recursive: true, force: true });
  });

  it("answers 409 to a second scan and serves partial results while the first runs", async () => {
    root = tempDir("mw-http-"); outside = tempDir("mw-out-");
    makeTree(root, outside);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const counter = { calls: [] as string[] };
    s = await start({
      mediaRoot: root, env: ENV,
      probe: stubProbe(counter, (p) => (p.startsWith("tv/") ? gate : undefined)),
    });
    const post = () => fetch(`${s!.base}/scan`, { method: "POST", headers: s!.auth, body: "{}" });
    const first = await post();
    assert.equal(first.status, 202);
    assert.equal(((await first.json()) as { state: string }).state, "running");
    assert.equal((await post()).status, 409);

    let body: { scan: { state: string }; titles: { id: string }[] } | undefined;
    for (let i = 0; i < 100; i++) {
      body = (await (await fetch(`${s.base}/library`, { headers: s.auth })).json()) as typeof body;
      if (body!.titles.length >= 2) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(body!.scan.state, "running");
    assert.deepEqual(body!.titles.map((t) => t.id).sort(), ["movies/A (1999)", "movies/Loose.mp4"]);

    release();
    await s.r.scanner.whenIdle();
    const done = (await (await fetch(`${s.base}/library`, { headers: s.auth })).json()) as { scan: { state: string }; titles: unknown[] };
    assert.equal(done.scan.state, "idle");
    assert.equal(done.titles.length, 3);
  });
});

describe("nightly schedule (injected clock)", () => {
  it("nextRunAt is the next 04:00, never now", () => {
    assert.deepEqual(nextRunAt(new Date(2026, 10, 5, 3, 0, 0)), new Date(2026, 10, 5, 4, 0, 0));
    assert.deepEqual(nextRunAt(new Date(2026, 10, 5, 4, 0, 0)), new Date(2026, 10, 6, 4, 0, 0));
    assert.deepEqual(nextRunAt(new Date(2026, 10, 5, 12, 30, 0)), new Date(2026, 10, 6, 4, 0, 0));
  });

  it("fires at 04:00, then re-arms for the next day", () => {
    let clock = new Date(2026, 10, 5, 3, 0, 0);
    const timers: { fn: () => void; ms: number }[] = [];
    let runs = 0;
    scheduleNightly(() => { runs++; }, { now: () => clock, setTimer: (fn, ms) => timers.push({ fn, ms }) });
    assert.equal(timers[0].ms, 3600_000);
    clock = new Date(2026, 10, 5, 4, 0, 0);
    timers[0].fn();
    assert.equal(runs, 1);
    assert.equal(timers[1].ms, 24 * 3600_000);
  });

  it("stop() prevents a fire", () => {
    const timers: (() => void)[] = [];
    let runs = 0;
    const h = scheduleNightly(() => { runs++; }, { setTimer: (fn) => timers.push(fn) });
    h.stop();
    timers[0]();
    assert.equal(runs, 0);
  });
});

import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { checkReady } from "./disk.ts";
import { createGuard } from "./fsguard.ts";
import { createQueue, KEEP_FINISHED, JobError, publicJob, type JobRecord, type QueueOpts } from "./jobs.ts";
import { realFs } from "./swap.ts";
import { SKIP_OFF_LINUX, tempDir } from "./testkit.ts";
import type { MediaFile } from "./types.ts";

const GB = 2 ** 30;
/** pump() calls run() one microtask after it sets running; let it start before reading `started`. */
const tick = () => new Promise<void>((r) => setImmediate(r));
let root: string;
let stateDir: string;

const file = (path: string, over: Partial<MediaFile> = {}): MediaFile => ({
  path, name: path.split("/").pop() as string, bytes: 4 * GB, mtimeMs: 1, nlink: 1, durationSec: 3600, container: "matroska",
  video: null, videoStreams: 1, attachments: 0, audio: [], subs: [],
  verdict: { kind: "compress", tune: null, ratio: 3, targetKbps: 4000, crf: 22, estSavingBytes: GB, reason: "Over the sweet spot" }, ...over,
});

before(() => {
  root = tempDir("mw-jobs-");
  for (const d of ["movies", "tv", ".nightwatch"]) mkdirSync(join(root, d));
  for (const n of ["a", "b", "c", "lean"]) writeFileSync(join(root, "movies", `${n}.mkv`), "x");
});
after(() => rmSync(root, { recursive: true, force: true }));

function make(over: Partial<QueueOpts> = {}) {
  stateDir = tempDir("mw-jobs-state-");
  const ready = checkReady(root);
  const guard = createGuard(ready.dirs);
  const lib: Record<string, MediaFile> = {
    "movies/a.mkv": file("movies/a.mkv"), "movies/b.mkv": file("movies/b.mkv"), "movies/c.mkv": file("movies/c.mkv"),
    "movies/lean.mkv": file("movies/lean.mkv", { verdict: { kind: "ok", ratio: 0.8, reason: "Already under the sweet spot" } }),
  };
  const started: string[] = [];
  const kills: string[] = [];
  const q = createQueue({
    stateDir, mediaRoot: root, dirs: ready.dirs, guard, fs: realFs, enabled: true, ready: () => ready,
    statfs: () => ({ bavail: 500 * GB / 4096, bsize: 4096 }), lookup: (p) => lib[p], uid: undefined,
    run: async (r) => { started.push(r.id); await new Promise(() => undefined); }, kill: (id) => kills.push(id),
    now: () => new Date("2026-11-05T00:00:00Z"), ...over,
  });
  return { q, started, kills, lib, ready, guard };
}

describe("enqueue rules (B2, B8)", { skip: SKIP_OFF_LINUX }, () => {
  it("refuses when Compress is off until calibration, and when the hold folder isn't ready", () => {
    assert.throws(() => make({ enabled: false }).q.enqueueOne("movies/a.mkv"), (e: unknown) => e instanceof JobError && e.status === 409 && /off until calibration/.test(e.message));
    assert.throws(() => make({ ready: () => ({ ready: false, reason: "Hold folder missing or not writable" }) }).q.enqueueOne("movies/a.mkv"), /unavailable: Hold folder/);
  });

  it("the off switch refuses even when the drive is ready", () => {
    assert.throws(() => make({ enabled: false, ready: () => ({ ready: true }) as ReturnType<QueueOpts["ready"]> }).q.enqueueOne("movies/a.mkv"), (e: unknown) => e instanceof JobError && e.status === 409);
  });

  it("a path outside movies/ and tv/ is a 400; a lean file is a 409 'not compressible'", () => {
    const { q } = make();
    assert.throws(() => q.enqueueOne("music/Decoy/decoy.mkv"), (e: unknown) => e instanceof JobError && e.status === 400);
    assert.throws(() => q.enqueueOne("movies/lean.mkv"), (e: unknown) => e instanceof JobError && e.status === 409 && /not compressible/i.test(e.message));
  });

  it("starts the first job only; a queued path is refused a second time", async () => {
    const { q, started } = make();
    const j = q.enqueueOne("movies/a.mkv");
    q.enqueueOne("movies/b.mkv");
    await tick();
    assert.equal(started.length, 1);
    assert.equal(started[0], j.id);
    assert.throws(() => q.enqueueOne("movies/b.mkv"), /Already queued/);
    q.patch(j.id, { state: "encoding" }); // the real runner does this first (runner.ts:94); the fake run doesn't
    assert.equal(q.snapshot({ enabled: true, ready: true }).queue.length, 1);
  });

  it("S9: a path whose earlier job is done is refused with the Undo date", () => {
    const { q } = make();
    const j = q.enqueueOne("movies/a.mkv");
    q.patch(j.id, { state: "done", heldUntil: "2026-11-12T03:00:00Z" });
    assert.throws(() => q.enqueueOne("movies/a.mkv"), /Already compressed; Undo it or wait until 12 Nov/);
  });

  it("S5: a file owned by another user is refused", () => {
    const { q } = make({ uid: (statSync(join(root, "movies", "a.mkv")).uid) + 1 });
    assert.throws(() => q.enqueueOne("movies/a.mkv"), /Owned by another user/);
  });

  it("507 when the disk can't hold the output plus the 20 GB margin (B6)", () => {
    const { q } = make({ statfs: () => ({ bavail: 10 * GB / 4096, bsize: 4096 }) });
    assert.throws(() => q.enqueueOne("movies/a.mkv"), (e: unknown) => e instanceof JobError && e.status === 507 && /Needs 24\.0 GB free/.test(e.message));
  });
});

describe("batch (S4, D16)", { skip: SKIP_OFF_LINUX }, () => {
  it("3 paths give 3 jobs under one batchId, one running; batch cancel cancels them all", async () => {
    const { q, started, kills } = make();
    const b = q.enqueueBatch(["movies/a.mkv", "movies/b.mkv", "movies/c.mkv"]);
    assert.equal(b.jobs.length, 3);
    assert.ok(b.jobs.every((j) => j.batchId === b.batchId));
    await tick();
    assert.equal(started.length, 1);
    q.patch(started[0], { state: "encoding" });
    q.cancelBatch(b.batchId);
    assert.equal(q.all().filter((j) => j.state === "cancelled").length, 2);
    assert.deepEqual(kills, [started[0]]);
  });

  it("all-or-nothing: one bad path refuses the whole batch and queues none", () => {
    const { q } = make();
    assert.throws(() => q.enqueueBatch(["movies/a.mkv", "movies/lean.mkv"]), /not compressible/i);
    assert.equal(q.all().length, 0);
    assert.throws(() => q.enqueueBatch(Array.from({ length: 201 }, (_, i) => `movies/${i}.mkv`)), (e: unknown) => e instanceof JobError && e.status === 400);
  });
});

describe("cancel", { skip: SKIP_OFF_LINUX }, () => {
  it("a queued job is cancelled at once; a swapping job can't be", () => {
    const { q } = make();
    q.enqueueOne("movies/a.mkv");
    const b = q.enqueueOne("movies/b.mkv");
    assert.equal(q.cancel(b.id).state, "cancelled");
    const cur = q.all()[0];
    q.patch(cur.id, { state: "swapping" });
    assert.throws(() => q.cancel(cur.id), /already swapping/);
  });
});

describe("pump crash handler (H4)", { skip: SKIP_OFF_LINUX }, () => {
  it("a patch that throws inside the crash handler is logged, not an unhandled rejection", async () => {
    const logs: string[] = [];
    let q!: ReturnType<typeof make>["q"];
    ({ q } = make({ log: (l) => logs.push(l), run: async (r) => { q.patch(r.id, { state: "encoding" }); rmSync(stateDir, { recursive: true, force: true }); writeFileSync(stateDir, "x"); throw new Error("boom"); } }));
    q.enqueueOne("movies/a.mkv");
    await tick(); await tick(); await tick();
    assert.ok(logs.some((l) => /crashed: boom/.test(l)) && logs.some((l) => /not marked failed/.test(l)), logs.join("|"));
  });
});

describe("pump crash handler keeps done records (R1) and removes the part (R5)", { skip: SKIP_OFF_LINUX }, () => {
  it("a run that patches done and then throws leaves the record done", async () => {
    let q!: ReturnType<typeof make>["q"];
    ({ q } = make({ run: async (r) => { q.patch(r.id, { state: "done" }); throw new Error("late"); } }));
    q.enqueueOne("movies/a.mkv");
    await tick(); await tick(); await tick();
    assert.equal(q.all()[0].state, "done");
  });

  it("a crash while encoding marks failed and removes that job's .part", async () => {
    let q!: ReturnType<typeof make>["q"];
    let part = "";
    const m = make({ run: async (r) => { q.patch(r.id, { state: "encoding" }); part = q.plan(r).part; writeFileSync(part, "x"); throw new Error("vol"); } });
    q = m.q;
    q.enqueueOne("movies/a.mkv");
    await tick(); await tick(); await tick();
    assert.equal(q.all()[0].state, "failed");
    assert.equal(existsSync(part), false);
  });
});

describe("pump crash handler survives a failing .part remover (D1)", { skip: SKIP_OFF_LINUX }, () => {
  it("logs the remover error and still marks the job failed", async () => {
    let q!: ReturnType<typeof make>["q"];
    const logs: string[] = [];
    const m0 = make();
    const guard = { ...m0.guard, removeInside: () => { throw Object.assign(new Error("EIO"), { code: "EIO" }); } };
    const m = make({ guard, log: (l) => logs.push(l), run: async (r) => { q.patch(r.id, { state: "encoding" }); throw new Error("vol"); } });
    q = m.q;
    q.enqueueOne("movies/a.mkv");
    await tick(); await tick(); await tick();
    assert.equal(q.all()[0].state, "failed");
    assert.ok(logs.some((l) => /part not removed: EIO/.test(l)), logs.join("|"));
  });
});

describe("stranded swap and bounded stop (B1, B2, B6)", () => {
  /** A queued record put straight in (enqueue's path rule is POSIX-only), then pumped. */
  const seed = (q: ReturnType<typeof make>["q"]) => {
    q.all().push({ id: "s1", path: "movies/a.mkv", state: "queued", createdAt: "x", crf: 22, sourceBytes: 1, attempts: 0, abs: join(root, "movies", "a.mkv"), container: "matroska" } as JobRecord);
    q.pump();
  };

  it("B2: a run that throws while swapping exits 1 for boot recovery", async () => {
    const exits: number[] = [];
    let q!: ReturnType<typeof make>["q"];
    ({ q } = make({ exit: (c) => exits.push(c), run: async (r) => { q.patch(r.id, { state: "swapping" }); throw new Error("ENOSPC"); } }));
    seed(q);
    await tick(); await tick(); await tick();
    assert.deepEqual(exits, [1]);
    assert.equal(q.all()[0].state, "swapping"); // left for recover()
  });

  it("B6: an undo whose state write fails after the file moved back exits 1", async () => {
    const exits: number[] = [];
    const { q, ready } = make({ exit: (c) => exits.push(c) });
    const hold = join(ready.dirs.hold, "u1");
    mkdirSync(hold, { recursive: true });
    const abs = join(root, "movies", "a.mkv");
    writeFileSync(join(hold, "a.mkv"), "x"); // the held original, same bytes as the current file
    const st = statSync(abs);
    const rec = { id: "u1", path: "movies/a.mkv", state: "done", createdAt: "x", crf: 22, sourceBytes: 1, attempts: 0, abs, container: "matroska", newIno: st.ino, newSize: st.size } as JobRecord;
    q.all().push(rec);
    q.patch("u1", {}); // save with the record in place
    rmSync(stateDir, { recursive: true, force: true }); writeFileSync(stateDir, "x"); // every later save fails
    await assert.rejects(q.undo("u1"));
    assert.deepEqual(exits, [1]);
  });

  it("B1: stop() gives up after stopWaitMs when the running job never settles", async () => {
    const logs: string[] = [];
    const { q } = make({ stopWaitMs: 100, log: (l) => logs.push(l) });
    seed(q); // the default fake run never settles
    await tick();
    const t0 = Date.now();
    await q.stop();
    assert.ok(Date.now() - t0 < 2000);
    assert.ok(logs.some((l) => /did not stop within 100 ms/.test(l)), logs.join("|"));
  });
});

describe("hold clock and purge (B5)", () => {
  it("purge goes by heldUntil, never by file mtime", () => {
    const { q, ready } = make();
    const mk = (id: string, heldUntil: string) => {
      mkdirSync(join(ready.dirs.hold, id), { recursive: true });
      writeFileSync(join(ready.dirs.hold, id, "a.mkv"), "ORIGINAL");
      const rec = { id, path: "movies/a.mkv", state: "done", createdAt: "x", crf: 22, sourceBytes: 1, attempts: 0, abs: join(root, "movies", "a.mkv"), container: "matroska", heldUntil } as JobRecord;
      q.all().push(rec);
      return rec;
    };
    const future = mk("hold-future", "2026-11-06T00:00:00Z");
    const past = mk("hold-past", "2026-11-04T00:00:00Z");
    assert.equal(q.purgeDue(), 1);
    assert.equal(future.state, "done");
    assert.equal(past.state, "purged");
  });

  it("Undo after a purge is a 410 with the date", async () => {
    const { q } = make();
    q.all().push({ id: "purged-1", path: "movies/a.mkv", state: "purged", createdAt: "x", crf: 22, sourceBytes: 1, attempts: 0, abs: "x", container: "matroska", heldUntil: "2026-11-04T00:00:00Z" } as JobRecord);
    await assert.rejects(q.undo("purged-1"), (e: unknown) => e instanceof JobError && e.status === 410 && /deleted on 4 Nov/.test(e.message));
  });

  describe("a purged file's output is not re-compressed", { skip: SKIP_OFF_LINUX }, () => {
    const last = (state: string) => ({ id: "last-1", path: "movies/a.mkv", state, createdAt: "x", crf: 22, sourceBytes: 9, attempts: 0, abs: "x", container: "matroska", finishedAt: "2026-11-04T00:00:00Z", outputBytes: 4 * GB }) as JobRecord;
    it("refuses with 409 while the file is still the job's output", () => {
      const { q } = make();
      q.all().push(last("purged"));
      assert.throws(() => q.enqueueOne("movies/a.mkv"), (e: unknown) => e instanceof JobError && e.status === 409 && /Already compressed on 4 Nov/.test(e.message));
    });
    it("allows a file replaced since (different bytes)", () => {
      const { q, lib } = make();
      lib["movies/a.mkv"] = file("movies/a.mkv", { bytes: 5 * GB });
      q.all().push(last("purged"));
      assert.equal(q.enqueueOne("movies/a.mkv").state, "queued");
    });
    it("an undone last job still enqueues", () => {
      const { q } = make();
      q.all().push(last("undone"));
      assert.equal(q.enqueueOne("movies/a.mkv").state, "queued");
    });
  });

  it("the public job never carries a path on disk", { skip: SKIP_OFF_LINUX }, () => {
    const { q } = make();
    const j = q.enqueueOne("movies/a.mkv");
    assert.equal(JSON.stringify(j).includes(root.replaceAll("\\", "\\\\")), false);
    assert.equal("abs" in publicJob(q.all()[0]), false);
  });
});

const seed = (q: ReturnType<typeof make>["q"], id: string, state: JobRecord["state"], extra: Partial<JobRecord> = {}): JobRecord => {
  const r = { id, path: "movies/a.mkv", state, createdAt: "x", crf: 22, sourceBytes: 1, attempts: 0, abs: join(root, "movies", "a.mkv"), container: "matroska", ...extra } as JobRecord;
  q.all().push(r);
  q.patch(id, {});
  return r;
};

describe("boot recovery (M2, N4)", () => {
  it("encoding is re-queued at the head with attempts+1; at attempts 2 it fails 'restart'", () => {
    const first = make();
    seed(first.q, "enc-1", "encoding");
    const again = createQueue({ ...second(first), run: async () => undefined });
    again.recover();
    assert.equal(again.get("enc-1")?.attempts, 1);
    again.patch("enc-1", { state: "verifying" });
    const third = createQueue({ ...second(first), run: async () => undefined });
    third.recover();
    assert.equal(third.get("enc-1")?.state, "failed");
    assert.equal(third.get("enc-1")?.failedCheck, "restart");
  });

  it("swapping with the source deleted keeps the hold file and the worker boots (M2)", () => {
    const first = make();
    const hold = join(first.ready.dirs.hold, "swap-1");
    mkdirSync(hold, { recursive: true });
    writeFileSync(join(hold, "a.mkv"), "ORIGINAL");
    seed(first.q, "swap-1", "swapping", { srcIno: 999999, outIno: 888888, srcSize: 1, srcMtimeMs: 1, abs: join(root, "movies", "gone.mkv") });
    const again = createQueue({ ...second(first), run: async () => undefined });
    again.recover();
    assert.equal(again.get("swap-1")?.state, "failed");
    assert.equal(again.get("swap-1")?.failedCheck, "swap");
    assert.match(again.get("swap-1")?.error ?? "", /kept in the hold folder/);
    assert.equal(statSync(join(hold, "a.mkv")).size, 8);
  });
});

describe("recovery and purge only when the drive is ready (F1, F5, F6)", () => {
  it("F1: not ready at boot, ready later: the first enqueue re-queues the old record first", { skip: SKIP_OFF_LINUX }, async () => {
    const first = make();
    seed(first.q, "enc-late", "encoding");
    let up = false;
    const started: string[] = [];
    const again = createQueue({
      ...second(first), ready: () => (up ? first.ready : { ready: false, reason: "drive missing" }),
      run: async (r) => { started.push(r.id); await new Promise(() => undefined); },
    });
    assert.throws(() => again.enqueueOne("movies/b.mkv"), JobError); // not ready: nothing runs, nothing recovered
    assert.equal(again.get("enc-late")?.state, "encoding");
    up = true;
    again.enqueueOne("movies/b.mkv");
    await tick();
    assert.equal(started[0], "enc-late");
    assert.equal(again.get("enc-late")?.attempts, 1);
  });

  it("F1: recoverOnce runs recovery once", () => {
    const first = make();
    seed(first.q, "enc-once", "encoding");
    const again = createQueue({ ...second(first), run: () => new Promise(() => undefined) });
    again.recoverOnce();
    again.patch("enc-once", { state: "encoding" });
    again.recoverOnce();
    assert.equal(again.get("enc-once")?.attempts, 1);
    assert.equal(again.get("enc-once")?.state, "encoding");
  });

  it("F5: purge with the drive gone marks nothing purged", () => {
    const { q } = make({ ready: () => ({ ready: false, reason: "drive missing" }) });
    seed(q, "held-1", "done", { heldUntil: "2026-11-04T00:00:00Z" });
    assert.equal(q.purgeDue(), 0);
    assert.equal(q.get("held-1")?.state, "done");
  });

  it("F6: a cancel requested before a restart ends cancelled, not re-queued", () => {
    const first = make();
    seed(first.q, "enc-cx", "encoding", { cancelRequested: true });
    const again = createQueue({ ...second(first), run: () => new Promise(() => undefined) });
    again.recover();
    assert.equal(again.get("enc-cx")?.state, "cancelled");
  });
});

/** Same state dir, a fresh queue: a worker restart. */
function second(first: ReturnType<typeof make>): QueueOpts {
  return {
    stateDir, mediaRoot: root, dirs: first.ready.dirs, guard: first.guard, fs: realFs, enabled: true, ready: () => first.ready,
    statfs: () => ({ bavail: 500 * GB / 4096, bsize: 4096 }), lookup: (p) => first.lib[p], uid: undefined,
    run: async () => undefined, kill: () => undefined, now: () => new Date("2026-11-05T00:00:00Z"),
  };
}

describe("boot prunes old finished jobs (H7)", () => {
  const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
  const STATES = ["failed", "purged", "cancelled", "undone"] as const;
  it("cuts superseded records to the cap; the latest record of a file, done, held and active records stay", () => {
    const first = make();
    // the only record of its file, and the oldest: must survive
    seed(first.q, "lone-purged", "purged", { path: "movies/lone.mkv", finishedAt: day(-9) });
    // superseded: each older record shares its path with the newer "latest-N"
    for (let i = 0; i < KEEP_FINISHED + 50; i++) {
      seed(first.q, `old-${i}`, STATES[i % 4], { path: `movies/f${i}.mkv`, finishedAt: day(i) });
      seed(first.q, `new-${i}`, "done", { path: `movies/f${i}.mkv`, finishedAt: day(i), heldUntil: "2026-12-01T00:00:00Z" });
    }
    seed(first.q, "kept-hold", "failed", { path: "movies/h.mkv", finishedAt: day(-5), keepHold: true });
    seed(first.q, "q-1", "queued", { path: "movies/q.mkv" });
    seed(first.q, "swap-1", "swapping", { path: "movies/s.mkv" });
    const again = createQueue({ ...second(first), run: async () => undefined });
    const ids = again.all().map((j) => j.id);
    assert.equal(ids.filter((id) => id.startsWith("old-")).length, KEEP_FINISHED);
    assert.equal(again.get("old-0"), undefined);
    assert.ok(again.get(`old-${KEEP_FINISHED + 49}`));
    assert.equal(ids.filter((id) => id.startsWith("new-")).length, KEEP_FINISHED + 50);
    for (const id of ["lone-purged", "kept-hold", "q-1", "swap-1"]) assert.ok(again.get(id), id);
    assert.equal(again.get("swap-1")?.state, "swapping");
    const onDisk = createQueue({ ...second(first), run: async () => undefined });
    assert.equal(onDisk.all().length, ids.length);
  });

  it("a record with no timestamps does not crash the sort", () => {
    const first = make();
    seed(first.q, "bare-1", "failed", { path: "movies/b.mkv", createdAt: undefined as unknown as string });
    seed(first.q, "bare-2", "failed", { path: "movies/b.mkv", createdAt: undefined as unknown as string });
    seed(first.q, "bare-3", "failed", { path: "movies/b.mkv", createdAt: undefined as unknown as string });
    const again = createQueue({ ...second(first), run: async () => undefined });
    assert.equal(again.all().length, 3);
  });

  it("a failing save on load is logged, not thrown", () => {
    const first = make();
    for (let i = 0; i < KEEP_FINISHED + 2; i++) seed(first.q, `old-${i}`, "failed", { path: "movies/x.mkv", finishedAt: day(i) });
    seed(first.q, "latest", "done", { path: "movies/x.mkv", finishedAt: day(999), heldUntil: "2026-12-01T00:00:00Z" });
    const logs: string[] = [];
    const opts = { ...second(first), run: async () => undefined, log: (l: string) => logs.push(l) };
    mkdirSync(join(stateDir, "jobs.json.tmp")); // the atomic write opens this path, so the save throws
    const q = createQueue(opts);
    assert.equal(q.all().length, KEEP_FINISHED + 1); // pruned in memory, and the worker still started
    assert.ok(logs.some((l) => /not saved after pruning/.test(l)), logs.join("|"));
    rmSync(join(stateDir, "jobs.json.tmp"), { recursive: true, force: true });
  });
});

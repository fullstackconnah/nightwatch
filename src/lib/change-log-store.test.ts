import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readChangeLog, recordChangeLogTick, resetChangeLogState } from "./change-log-store.ts";
import type { LiveContainer } from "./change-log.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);
const dateOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const live = (name: string, o: Partial<LiveContainer> = {}): LiveContainer => ({
  id: `${name}-id`,
  name,
  state: "running",
  startedAt: NOW - DAY,
  finishedAt: null,
  exitCode: null,
  restartCount: 0,
  ...o,
});

let dir = "";
let prevEnv: string | undefined;
const hist = () => path.join(dir, "history");
const file = (n: string) => path.join(hist(), n);
const today = () => file(`changes-${dateOf(NOW)}.jsonl`);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "chlog-"));
  prevEnv = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  resetChangeLogState();
});
afterEach(() => {
  if (prevEnv === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevEnv;
  fs.rmSync(dir, { recursive: true, force: true });
});

const seed = (cs: LiveContainer[]) => recordChangeLogTick(NOW, async () => cs);

test("a first tick seeds the baseline and writes no event lines", async () => {
  await seed([live("a"), live("b")]);
  assert.equal(fs.existsSync(today()), false);
  const b = JSON.parse(fs.readFileSync(file("changes-baseline.json"), "utf8"));
  assert.equal(b.seededAt, NOW);
  assert.deepEqual(Object.keys(b.byName), ["a", "b"]);
});

test("a later start is appended, and the baseline file is rewritten", async () => {
  await seed([live("a")]);
  await recordChangeLogTick(NOW + 30_000, async () => [live("a", { startedAt: NOW + 10_000 })]);
  const lines = fs.readFileSync(today(), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [{ at: NOW + 10_000, k: "start", name: "a", id: "a-id" }]);
  assert.equal(JSON.parse(fs.readFileSync(file("changes-baseline.json"), "utf8")).lastTickAt, NOW + 30_000);
  assert.equal(fs.existsSync(file("changes-baseline.json.tmp")), false);
});

test("a thrown list writes nothing and keeps the stored baseline", async () => {
  await seed([live("a")]);
  const before = fs.readFileSync(file("changes-baseline.json"), "utf8");
  await recordChangeLogTick(NOW + 30_000, async () => {
    throw new Error("docker down");
  });
  assert.equal(fs.readFileSync(file("changes-baseline.json"), "utf8"), before);
  assert.equal(fs.existsSync(today()), false);
});

test("T10 retention prunes changes files older than 30 days, once, and never metrics or the baseline", async () => {
  fs.mkdirSync(hist(), { recursive: true });
  const old = file(`changes-${dateOf(NOW - 31 * DAY)}.jsonl`);
  const keep = file(`changes-${dateOf(NOW - 29 * DAY)}.jsonl`);
  const metrics = file(`metrics-${dateOf(NOW - 40 * DAY)}.jsonl`);
  for (const f of [old, keep, metrics]) fs.writeFileSync(f, "{}\n");
  await seed([live("a")]);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(keep), true);
  assert.equal(fs.existsSync(metrics), true);
  assert.equal(fs.existsSync(file("changes-baseline.json")), true);
  fs.writeFileSync(old, "{}\n");
  await recordChangeLogTick(NOW + 30_000, async () => [live("a")]);
  assert.equal(fs.existsSync(old), true, "prune runs once per UTC day");
});

test("T11 a corrupt baseline reseeds: no lines, a fresh seededAt, the file valid again", async () => {
  fs.mkdirSync(hist(), { recursive: true });
  fs.writeFileSync(file("changes-baseline.json"), "garbage{");
  await recordChangeLogTick(NOW, async () => [live("a", { startedAt: NOW - 1000 })]);
  assert.equal(fs.existsSync(today()), false);
  const b = JSON.parse(fs.readFileSync(file("changes-baseline.json"), "utf8"));
  assert.equal(b.seededAt, NOW);
  assert.ok("a" in b.byName);
});

test("T11 a baseline without finite lastTickAt is corrupt too", async () => {
  fs.mkdirSync(hist(), { recursive: true });
  fs.writeFileSync(file("changes-baseline.json"), JSON.stringify({ seededAt: 1, byName: { a: { id: "a-id", startedAt: 1, finishedAt: null, restartCount: 0, seen: 1 } } }));
  await recordChangeLogTick(NOW, async () => [live("a", { startedAt: NOW - 1000 })]);
  assert.equal(fs.existsSync(today()), false);
  assert.equal(JSON.parse(fs.readFileSync(file("changes-baseline.json"), "utf8")).seededAt, NOW);
});

test("T12 a day file at 1 MiB skips the append without throwing; the baseline still advances", async () => {
  await seed([live("a")]);
  fs.writeFileSync(today(), "x".repeat(1024 * 1024));
  await recordChangeLogTick(NOW + 30_000, async () => [live("a", { startedAt: NOW + 10_000 })]);
  assert.equal(fs.statSync(today()).size, 1024 * 1024);
  const b = JSON.parse(fs.readFileSync(file("changes-baseline.json"), "utf8"));
  assert.equal(b.lastTickAt, NOW + 30_000);
  assert.equal(b.byName.a.startedAt, NOW + 10_000);
});

test("T13 an event 3 days old, written today, is read for a 7-day window and not pruned", async () => {
  await seed([live("a")]);
  const line = { at: NOW - 3 * DAY, k: "start", name: "a", id: "a-id" };
  fs.writeFileSync(today(), `${JSON.stringify(line)}\n{bad\n`);
  const r = await readChangeLog(NOW - 7 * DAY, NOW);
  assert.deepEqual(r.lines, [line]);
  assert.equal(r.loggedFrom, Math.max(NOW, NOW - 30 * DAY));
  await recordChangeLogTick(NOW + 30_000, async () => [live("a")]);
  assert.equal(fs.existsSync(today()), true);
});

test("reading with no directory or no baseline gives no lines and loggedFrom null", async () => {
  assert.deepEqual(await readChangeLog(NOW - DAY, NOW), { lines: [], loggedFrom: null });
});

test("a file dated before since is not read", async () => {
  await seed([live("a")]);
  fs.writeFileSync(file(`changes-${dateOf(NOW - 5 * DAY)}.jsonl`), `${JSON.stringify({ at: NOW - 5 * DAY, k: "start", name: "a", id: "i" })}\n`);
  assert.deepEqual((await readChangeLog(NOW - 2 * DAY, NOW)).lines, []);
  assert.equal((await readChangeLog(NOW - 7 * DAY, NOW)).lines.length, 1);
});

test("a failed append keeps the baseline file and memory, and the next tick writes the event once", async () => {
  await seed([live("a")]);
  const baselineFile = file("changes-baseline.json");
  const before = fs.readFileSync(baselineFile);
  const tick = () => recordChangeLogTick(NOW + 30_000, async () => [live("a", { startedAt: NOW + 10_000 })]);
  fs.mkdirSync(today()); // a directory where the day file goes: the append throws
  await tick();
  assert.deepEqual(fs.readFileSync(baselineFile), before);
  fs.rmdirSync(today());
  await tick();
  const lines = fs.readFileSync(today(), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [{ at: NOW + 10_000, k: "start", name: "a", id: "a-id" }]);
  assert.equal(JSON.parse(fs.readFileSync(baselineFile, "utf8")).byName.a.startedAt, NOW + 10_000);
});

test("a day file cut off mid-line (no newline) does not swallow the next appended event", async () => {
  await seed([live("a")]);
  fs.mkdirSync(hist(), { recursive: true });
  fs.writeFileSync(today(), '{"at":1,"k":"sta'); // a write cut off by a full disk
  await recordChangeLogTick(NOW + 30_000, async () => [live("a", { startedAt: NOW + 10_000 })]);
  const { lines } = await readChangeLog(NOW - DAY, NOW + 30_000);
  assert.deepEqual(lines, [{ at: NOW + 10_000, k: "start", name: "a", id: "a-id" }]);
});

const spyWarn = () => {
  const calls: string[] = [];
  const orig = console.warn;
  console.warn = (m: unknown) => void calls.push(String(m));
  return { calls, restore: () => void (console.warn = orig) };
};

test("H46-2 a tick that fails, recovers and fails again warns both times", async () => {
  const w = spyWarn();
  try {
    const boom = async () => {
      throw new Error("docker down");
    };
    await recordChangeLogTick(NOW, boom);
    await seed([live("a")]);
    await recordChangeLogTick(NOW + 30_000, boom);
    assert.equal(w.calls.filter((c) => c.includes("tick failed")).length, 2);
  } finally {
    w.restore();
  }
});

test("H46-2 one unreadable day file is skipped and warned once; the readable lines are still returned", async () => {
  await seed([live("a")]);
  const line = { at: NOW - 1000, k: "start", name: "a", id: "a-id" };
  fs.writeFileSync(today(), `${JSON.stringify(line)}\n`);
  fs.mkdirSync(file(`changes-${dateOf(NOW - DAY)}.jsonl`)); // a directory: readFile fails with EISDIR
  const w = spyWarn();
  try {
    const first = await readChangeLog(NOW - 2 * DAY, NOW);
    assert.deepEqual(first.lines, [line]);
    assert.equal(typeof first.loggedFrom, "number");
    await readChangeLog(NOW - 2 * DAY, NOW);
    assert.equal(w.calls.filter((c) => c.includes("could not be read")).length, 1);
  } finally {
    w.restore();
  }
});

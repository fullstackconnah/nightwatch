import { after, afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

// metrics-history imports "@/lib/...", which plain node cannot resolve; map it for this process only. docker is stubbed: no daemon.
const SRC = new URL("../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s === "@/lib/docker") return { url: "data:text/javascript,export async function listContainers(){return []}", shortCircuit: true };
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  return next(s, c);
}`));
const { queryMetricsHistory, queryMountHistory, recordMetricsHistoryTick } = await import("./metrics-history.ts");

type Maps = Map<string, { mtimeMs: number; lastUsed?: number }>;
const g = globalThis as unknown as Record<string, unknown> & {
  __metricsHistoryFileCache?: Maps;
  __metricsHistoryMountCache?: Maps;
  __metricsHistoryLastSampleTs?: number;
  __metricsHistoryWriting?: boolean;
};
const FIELDS = ["LastSampleTs", "LastPrunedDate", "Warned", "FileCache", "MountCache", "Since", "Writing"];

const keepAlive = setInterval(() => {}, 1000); // an unref'd timer would let Node 22 cancel the run
after(() => clearInterval(keepAlive));

const DAY = 24 * 60 * 60 * 1000;
const host = { cpuPct: 1, memUsed: 1, memTotal: 2 };
const key = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const sample = (t: number) =>
  JSON.stringify({ t, cpu: 5, memUsed: 1, memTotal: 2, mounts: { "/real": 100 }, containers: { web: [7, 1, 0, 0] } });
const waitFor = async (ok: () => boolean) => {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(ok(), "timed out");
};

let dir: string;
let prevEnv: string | undefined;
const file = (ts: number) => path.join(dir, "history", `metrics-${key(ts)}.jsonl`);

beforeEach(() => {
  prevEnv = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-histbounds-"));
  process.env.DATA_DIR = dir;
  fs.mkdirSync(path.join(dir, "history"));
  for (const f of FIELDS) g[`__metricsHistory${f}`] = undefined;
});

afterEach(() => {
  mock.restoreAll();
  if (prevEnv === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevEnv;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("mount query guards (H92-1)", () => {
  it("inherited property names and unknown mounts give all-null points", async () => {
    const now = Date.now();
    fs.writeFileSync(file(now), `${sample(now - 60_000)}\n${sample(now - 30_000)}\n`);
    const r = await queryMountHistory("24h", ["constructor", "toString", "__proto__", "/nope", "/real"]);
    for (const name of ["constructor", "toString", "__proto__", "/nope"]) {
      assert.ok(r.mounts[name].length > 0);
      assert.ok(r.mounts[name].every((p) => p.usedBytes === null), name);
    }
    assert.ok(r.mounts["/real"].some((p) => p.usedBytes === 100));
    assert.deepEqual((await queryMountHistory("24h", [])).mounts, {});
  });
});

describe("one history write at a time (H92-3)", () => {
  it("skips ticks while a write is pending, without advancing the sample clock", async () => {
    const T = Date.now();
    let release!: () => void;
    const appendFile = mock.method(fsp, "appendFile", () => new Promise<void>((r) => (release = r)));
    recordMetricsHistoryTick({ ts: T, host, mounts: null, containers: {} });
    await waitFor(() => appendFile.mock.callCount() === 1);
    recordMetricsHistoryTick({ ts: T + 31_000, host, mounts: null, containers: {} });
    recordMetricsHistoryTick({ ts: T + 62_000, host, mounts: null, containers: {} });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(appendFile.mock.callCount(), 1);
    assert.equal(g.__metricsHistoryLastSampleTs, T);
    release();
    await waitFor(() => !g.__metricsHistoryWriting);
    recordMetricsHistoryTick({ ts: T + 93_000, host, mounts: null, containers: {} });
    await waitFor(() => appendFile.mock.callCount() === 2);
    release();
  });

  it("a rejected write clears the flag", async () => {
    const T = Date.now();
    const appendFile = mock.method(fsp, "appendFile", () => Promise.reject(new Error("disk")));
    const warn = mock.method(console, "warn", () => {});
    recordMetricsHistoryTick({ ts: T, host, mounts: null, containers: {} });
    await waitFor(() => appendFile.mock.callCount() === 1 && !g.__metricsHistoryWriting);
    recordMetricsHistoryTick({ ts: T + 31_000, host, mounts: null, containers: {} });
    await waitFor(() => appendFile.mock.callCount() === 2);
    assert.ok(warn.mock.callCount() >= 1);
  });
});

describe("history caches are bounded (H92-2)", () => {
  const seedDays = (now: number) => {
    for (const d of [0, 1, 2]) fs.writeFileSync(file(now - d * DAY), `${sample(now - d * DAY - 1000)}\n`);
  };

  it("the mount reader keeps slim entries and leaves the full cache empty", async () => {
    const now = Date.now();
    seedDays(now);
    const r = await queryMountHistory("7d", ["/real"]);
    assert.ok(r.mounts["/real"].some((p) => p.usedBytes === 100));
    assert.equal(g.__metricsHistoryFileCache?.size ?? 0, 0);
    assert.equal(g.__metricsHistoryMountCache?.size, 3);
    const entry = [...g.__metricsHistoryMountCache!.values()][0] as unknown as { samples: Record<string, unknown>[] };
    assert.deepEqual(Object.keys(entry.samples[0]).sort(), ["mounts", "t"]);
  });

  it("the full reader is intact after the mount reader ran first", async () => {
    const now = Date.now();
    seedDays(now);
    await queryMountHistory("7d", ["/real"]);
    const r = await queryMetricsHistory("24h", ["web"]);
    assert.ok(r.containers.web.some((b) => b.cpuPct === 7));
  });

  it("evicts full-cache entries idle for over 5 minutes and keeps recent ones", async () => {
    const now = Date.now();
    seedDays(now);
    await queryMetricsHistory("7d", []);
    const cache = g.__metricsHistoryFileCache!;
    assert.equal(cache.size, 3);
    const [stale, ...rest] = [...cache.keys()];
    cache.get(stale)!.lastUsed = now - 6 * 60_000;
    await queryMetricsHistory("1h", []);
    assert.ok(!cache.has(stale));
    for (const k of rest) assert.ok(cache.has(k));
  });

  it("prune drops the mount cache entry of a deleted file", async () => {
    const now = Date.now();
    const old = file(now - 20 * DAY);
    fs.writeFileSync(old, `${sample(now - 20 * DAY)}\n`);
    g.__metricsHistoryMountCache = new Map([[old, { mtimeMs: 1, samples: [] } as never]]);
    recordMetricsHistoryTick({ ts: now, host, mounts: null, containers: {} });
    await waitFor(() => !g.__metricsHistoryWriting && !fs.existsSync(old));
    assert.ok(!g.__metricsHistoryMountCache.has(old));
  });
});

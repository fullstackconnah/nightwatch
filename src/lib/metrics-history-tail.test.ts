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

const key = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const rec = (t: number, cpu = 5, name = "web") =>
  JSON.stringify({ t, cpu, memUsed: 1, memTotal: 2, mounts: { "/real": 100 }, containers: { [name]: [7, 1, 0, 0] } });

let dir: string;
let prevEnv: string | undefined;
const file = (ts: number) => path.join(dir, "history", `metrics-${key(ts)}.jsonl`);
const NOW = Date.now();
const cpus = (m: Map<string, { samples: unknown[] }>) =>
  [...m.values()][0].samples.map((s) => (s as { cpu?: number }).cpu);

beforeEach(() => {
  prevEnv = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-histtail-"));
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

const seed = () => fs.writeFileSync(file(NOW), `${rec(NOW - 90_000, 1)}\n${rec(NOW - 60_000, 2)}\n`);
const full = () => g.__metricsHistoryFileCache as unknown as Map<string, { samples: unknown[] }>;
const mounts = () => g.__metricsHistoryMountCache as unknown as Map<string, { samples: unknown[] }>;

describe("history readers read only appended bytes", () => {
  it("full reader tails an append", async () => {
    seed();
    await queryMetricsHistory("24h", ["web"]);
    const readFile = mock.method(fsp, "readFile");
    fs.appendFileSync(file(NOW), `${rec(NOW - 30_000, 3)}\n`);
    await queryMetricsHistory("24h", ["web"]);
    assert.deepEqual(cpus(full()), [1, 2, 3]);
    assert.equal(readFile.mock.callCount(), 0);
  });

  it("mount reader tails an append", async () => {
    seed();
    await queryMountHistory("24h", ["/real"]);
    const readFile = mock.method(fsp, "readFile");
    fs.appendFileSync(file(NOW), `${rec(NOW - 30_000, 3)}\n`);
    await queryMountHistory("24h", ["/real"]);
    assert.equal(mounts().size, 1);
    assert.equal([...mounts().values()][0].samples.length, 3);
    assert.equal(readFile.mock.callCount(), 0);
  });

  it("a torn line is skipped until completed, then counted once", async () => {
    seed();
    await queryMetricsHistory("24h", ["web"]);
    const line = rec(NOW - 30_000, 3);
    fs.appendFileSync(file(NOW), line.slice(0, 20));
    await queryMetricsHistory("24h", ["web"]);
    assert.deepEqual(cpus(full()), [1, 2]);
    fs.appendFileSync(file(NOW), `${line.slice(20)}\n`);
    await queryMetricsHistory("24h", ["web"]);
    assert.deepEqual(cpus(full()), [1, 2, 3]);
  });

  it("two readers at once count each sample once", async () => {
    seed();
    await queryMetricsHistory("24h", ["web"]);
    fs.appendFileSync(file(NOW), `${rec(NOW - 30_000, 3)}\n`);
    await Promise.all([queryMetricsHistory("24h", ["web"]), queryMetricsHistory("24h", ["web"])]);
    assert.deepEqual(cpus(full()), [1, 2, 3]);
  });

  it("a replaced shorter file is re-read in full", async () => {
    seed();
    await queryMetricsHistory("24h", ["web"]);
    fs.writeFileSync(file(NOW), `${rec(NOW - 10_000, 9)}\n`);
    await queryMetricsHistory("24h", ["web"]);
    assert.deepEqual(cpus(full()), [9]);
  });

  it("offsets count bytes across multi-byte appends", async () => {
    seed();
    await queryMetricsHistory("24h", ["web"]);
    fs.appendFileSync(file(NOW), `${rec(NOW - 30_000, 3, "é日本")}\n`);
    await queryMetricsHistory("24h", ["web"]);
    fs.appendFileSync(file(NOW), `${rec(NOW - 20_000, 4)}\n`);
    await queryMetricsHistory("24h", ["web"]);
    assert.deepEqual(cpus(full()), [1, 2, 3, 4]);
    const s = [...full().values()][0].samples[2] as { containers: Record<string, number[]> };
    assert.deepEqual(Object.keys(s.containers), ["é日本"]);
  });
});

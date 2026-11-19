import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

// metrics-history imports "@/lib/...", which plain node cannot resolve; map it for this process only. docker is stubbed: no daemon, and dockerode need not be installed.
const SRC = new URL("../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s === "@/lib/docker") return { url: "data:text/javascript,export async function listContainers(){throw new Error('no docker')}", shortCircuit: true };
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  return next(s, c);
}`));
const { recordMetricsHistoryTick } = await import("./metrics-history.ts");

const g = globalThis as unknown as { __metricsHistoryWarned?: Set<string>; __metricsHistoryLastSampleTs?: number };
const host = { cpuPct: 1, memUsed: 1, memTotal: 2 };
const waitFor = async (ok: () => boolean) => {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(ok(), "timed out waiting for the history write to settle");
};

let dir: string;
let bad: string;
let prevEnv: string | undefined;
let prevWarn: typeof console.warn;
let warns: string[];

beforeEach(() => {
  prevEnv = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-histwarn-"));
  bad = path.join(dir, "not-a-dir");
  fs.writeFileSync(bad, ""); // a file where the data dir should be: mkdir of history/ fails
  g.__metricsHistoryWarned = undefined;
  g.__metricsHistoryLastSampleTs = undefined;
  warns = [];
  prevWarn = console.warn;
  console.warn = (...a: unknown[]) => void warns.push(String(a[0]));
});

afterEach(() => {
  console.warn = prevWarn;
  if (prevEnv === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevEnv;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("metrics history write warning", () => {
  it("a failure, a success, then a failure logs twice", async () => {
    const writeWarns = () => warns.filter((w) => w.includes("write failed")).length;
    const T = Date.UTC(2026, 10, 20);

    process.env.DATA_DIR = bad;
    recordMetricsHistoryTick({ ts: T, host, mounts: null, containers: {} });
    await waitFor(() => writeWarns() === 1);

    const good = path.join(dir, "good");
    process.env.DATA_DIR = good;
    recordMetricsHistoryTick({ ts: T + 31_000, host, mounts: null, containers: {} });
    await waitFor(() => fs.existsSync(path.join(good, "history")));
    await waitFor(() => !g.__metricsHistoryWarned?.has("write failed — history dir unwritable"));

    process.env.DATA_DIR = bad;
    recordMetricsHistoryTick({ ts: T + 62_000, host, mounts: null, containers: {} });
    await waitFor(() => writeWarns() === 2);
  });
});

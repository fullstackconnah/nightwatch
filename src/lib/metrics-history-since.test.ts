import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

// metrics-history imports "@/lib/...", which plain node cannot resolve; map it for this process only.
const SRC = new URL("../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  return next(s, c);
}`));
const { queryMetricsHistory } = await import("./metrics-history.ts");

const DAY = 24 * 60 * 60 * 1000;
const g = globalThis as unknown as { __metricsHistoryFileCache?: Map<string, unknown> };
const sample = (t: number) => JSON.stringify({ t, cpu: 1, memUsed: 1, memTotal: 2, mounts: {}, containers: {} });
const key = (ts: number) => new Date(ts).toISOString().slice(0, 10);

let dir: string;
let prevEnv: string | undefined;
const file = (ts: number) => path.join(dir, "history", `metrics-${key(ts)}.jsonl`);

beforeEach(() => {
  prevEnv = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-histsince-"));
  process.env.DATA_DIR = dir;
  fs.mkdirSync(path.join(dir, "history"));
  g.__metricsHistoryFileCache?.clear();
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevEnv;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("recordingSince", () => {
  it("returns the oldest file's first t without parsing that file into the cache", async () => {
    const now = Date.now();
    const old = now - 10 * DAY;
    fs.writeFileSync(file(old), `\n${sample(old)}\n${sample(old + 30000)}\n`);
    fs.writeFileSync(file(now), `\n${sample(now - 1000)}\n`);
    const r = await queryMetricsHistory("1h", []);
    assert.equal(r.recordingSince, old);
    assert.ok(!g.__metricsHistoryFileCache?.has(file(old)), "oldest day file must not be in the parsed cache");
  });

  it("skips a corrupt first line and uses the next one", async () => {
    const now = Date.now();
    fs.writeFileSync(file(now), `{"t":12\n${sample(now - 5000)}\n`);
    assert.equal((await queryMetricsHistory("1h", [])).recordingSince, now - 5000);
  });

  it("is null for an empty oldest file", async () => {
    fs.writeFileSync(file(Date.now()), "");
    assert.equal((await queryMetricsHistory("1h", [])).recordingSince, null);
  });

  it("does not serve a stale value once a different file is the oldest", async () => {
    const now = Date.now();
    const old = now - 10 * DAY;
    const mid = now - 5 * DAY;
    fs.writeFileSync(file(old), `${sample(old)}\n`);
    fs.writeFileSync(file(mid), `${sample(mid)}\n`);
    assert.equal((await queryMetricsHistory("1h", [])).recordingSince, old);
    fs.unlinkSync(file(old));
    assert.equal((await queryMetricsHistory("1h", [])).recordingSince, mid);
  });
});

describe("recordingSince leading blank line (H76-4)", () => {
  it("skips a blank first line and reads the sample on the next", async () => {
    const now = Date.now();
    fs.writeFileSync(file(now), `\n${sample(now - 7000)}\n`);
    assert.equal((await queryMetricsHistory("1h", [])).recordingSince, now - 7000);
  });

  it("skips several blank lines before a torn line and then the valid sample", async () => {
    const now = Date.now();
    fs.writeFileSync(file(now), `\n\n{"t":1\n${sample(now - 3000)}\n`);
    assert.equal((await queryMetricsHistory("1h", [])).recordingSince, now - 3000);
  });
});

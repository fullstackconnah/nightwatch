import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTempMaxC, rejoinProcessRow, tempMaxRetryDue } from "./gpu-parse.ts";

const gpuSrc = readFileSync(fileURLToPath(new URL("./gpu.ts", import.meta.url)), "utf8");

test("F5: a blank value falls back to Shutdown Temp, not 0", () => {
  const report = ["    GPU Slowdown Temp                 :", "    GPU Shutdown Temp                 : 93 C"].join("\n");
  assert.equal(parseTempMaxC(report), 93);
});

test("F5: a normal value parses and N/A stays null", () => {
  assert.equal(parseTempMaxC("    GPU Slowdown Temp : 87 C"), 87);
  assert.equal(parseTempMaxC("    GPU Slowdown Temp : N/A"), null);
});

test("F5: a failed lookup is retried after 60 s, a parsed one never", () => {
  assert.equal(tempMaxRetryDue(1000, 1000 + 59_000), false);
  assert.equal(tempMaxRetryDue(1000, 1000 + 60_000), true);
});

test("F5: the catch path is not cached for ever", () => {
  assert.match(gpuSrc, /^\s+__gpuTempMaxFailedAt\?: number;\s*$/m);
  assert.match(gpuSrc, /tempMaxRetryDue\(/);
});

test("F6: a process name with commas keeps the memory column", () => {
  assert.deepEqual(rejoinProcessRow(["1234", "/opt/a", "b/python", "512 MiB"]), ["1234", "/opt/a,b/python", "512 MiB"]);
  assert.deepEqual(rejoinProcessRow(["1234", "python", "512"]), ["1234", "python", "512"]);
  assert.deepEqual(rejoinProcessRow(["1234"]), ["1234"]);
});

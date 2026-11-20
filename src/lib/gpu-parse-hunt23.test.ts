import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cellNumber, mibToBytes, parseTempMaxC, rejoinProcessRow, tempMaxRetryDue } from "./gpu-parse.ts";

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

test("G1: N/A, Not Supported, Unknown Error and blank cells parse to null, not 0", () => {
  for (const raw of ["[N/A]", "[Not Supported]", "[Unknown Error]", "", "  ", undefined, "abc"]) {
    assert.equal(cellNumber(raw), null, String(raw));
    assert.equal(mibToBytes(cellNumber(raw)), null, String(raw));
  }
});

test("G1: a real 0 stays 0 and MiB converts to bytes", () => {
  assert.equal(cellNumber("0"), 0);
  assert.equal(mibToBytes(cellNumber("0")), 0);
  assert.equal(mibToBytes(cellNumber("2")), 2 * 1024 * 1024);
});

test("G1: the four utilisation and memory fields use cellNumber, not a zero fallback", () => {
  for (const name of ["utilization.gpu", "utilization.memory", "memory.used", "memory.total"]) {
    assert.ok(gpuSrc.includes(`cellNumber(get(c, "${name}"))`), name);
  }
  assert.doesNotMatch(gpuSrc, /cellNumberOrZero\(get\(c, "(utilization|memory)/);
});

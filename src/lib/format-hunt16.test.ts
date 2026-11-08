import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatNumber, formatPercent, formatRate, formatBitrate, formatUptime } from "./format.ts";

test("formatBytes moves up a unit when the value rounds to 1024", () => {
  assert.equal(formatBytes(1023.6), "1.0 KiB");
  assert.equal(formatBytes(1048571), "1.0 MiB");
  assert.equal(formatBytes(1048524), "1023.9 KiB");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1536), "1.5 KiB");
});

test("formatBytes stays on the last unit", () => {
  assert.match(formatBytes(1024 ** 5 * 2000), /PiB$/);
});

test("formatNumber prints M from 999,950", () => {
  assert.equal(formatNumber(999_950), "1.0M");
  assert.equal(formatNumber(999_949), "999.9k");
  assert.equal(formatNumber(2_500_000), "2.5M");
});

test("formatters treat Infinity like NaN", () => {
  for (const bad of [Infinity, -Infinity, NaN]) {
    assert.equal(formatBytes(bad), "—");
    assert.equal(formatRate(bad), "—");
    assert.equal(formatBitrate(bad), "—");
    assert.equal(formatUptime(bad), "—");
    assert.equal(formatPercent(bad), "—");
    assert.equal(formatNumber(bad), "—");
  }
});

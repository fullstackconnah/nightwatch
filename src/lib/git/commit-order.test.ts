import test from "node:test";
import assert from "node:assert/strict";
import { commitDate, newestFirst } from "./commit-order.ts";

test("a missing author date is null, not the 1970 epoch", () => {
  assert.equal(commitDate(undefined), null);
  assert.equal(commitDate(""), null);
  assert.equal(commitDate("2026-11-09T01:00:00Z"), "2026-11-09T01:00:00Z");
});

test("null-dated commits sort last", () => {
  const rows = [{ date: null }, { date: "2026-11-01T00:00:00Z" }, { date: "2026-11-05T00:00:00Z" }, { date: null }];
  assert.deepEqual(rows.sort(newestFirst).map((r) => r.date), ["2026-11-05T00:00:00Z", "2026-11-01T00:00:00Z", null, null]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { laneActivityText } from "./lane-activity.ts";

const NOW = Date.now();
const min = (m: number) => new Date(NOW + m * 60000).toISOString();

test("laneActivityText: missing, bad or pre-2000 times give null (the 'no activity yet' case)", () => {
  for (const v of [null, undefined, "garbage", "", 0, "1970-01-01T00:00:00Z", {}, [], true, NaN]) {
    assert.equal(laneActivityText(v), null, String(JSON.stringify(v)));
  }
});

test("laneActivityText: a valid time reads 'active <age>'; the future reads 'just now'", () => {
  assert.equal(laneActivityText(min(-10)), "active 10m ago");
  assert.equal(laneActivityText(min(5)), "active just now");
  assert.equal(laneActivityText(NOW - 3600000), "active 1h ago");
});

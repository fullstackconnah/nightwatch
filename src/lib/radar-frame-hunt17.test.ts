import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const route = readFileSync(
  fileURLToPath(new URL("../app/kiosk/api/weather/radar/frame/route.ts", import.meta.url)),
  "utf8",
);

test("radar frame route refuses a stamp not in the published list, before any fetch", () => {
  const refuse = route.search(/^\s+if \(!isListedFrame\(t, loop\.frames\)\)/m);
  assert.ok(refuse > 0);
  assert.ok(refuse < route.indexOf("await fetch("));
});

test("radar frame route skips the fetch for a recent miss and records new misses", () => {
  assert.match(route, /^\s+if \(frameCache\.missed\(upstreamPath\)\)/m);
  assert.match(route, /^\s+if \(layer === null\) frameCache\.markMiss\(upstreamPath\);/m);
});

import { isListedFrame } from "./radar-frame.ts";

test("isListedFrame accepts one step before the oldest frame, refuses two", () => {
  const frames = ["202611080010", "202611080015", "202611080020"];
  assert.equal(isListedFrame("202611080015", frames), true);
  assert.equal(isListedFrame("202611080005", frames), true);
  assert.equal(isListedFrame("202611072355", frames), false);
  assert.equal(isListedFrame("202611080025", frames), false);
});

test("isListedFrame steps back across midnight", () => {
  assert.equal(isListedFrame("202611072355", ["202611080000", "202611080005"]), true);
});

test("radar frame route marks a miss only for timestamped frames, never static layers", () => {
  assert.doesNotMatch(route, /^\s+frameCache\.markMiss\(upstreamPath\);/m);
  assert.match(route, /^\s+if \(layer === null\) frameCache\.markMiss\(upstreamPath\);/m);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const route = readFileSync(
  fileURLToPath(new URL("../app/kiosk/api/weather/radar/frame/route.ts", import.meta.url)),
  "utf8",
);

test("radar frame route refuses a stamp not in the published list, before any fetch", () => {
  const refuse = route.search(/^\s+if \(!loop\.frames\.includes\(t\)\)/m);
  assert.ok(refuse > 0);
  assert.ok(refuse < route.indexOf("await fetch("));
});

test("radar frame route skips the fetch for a recent miss and records new misses", () => {
  assert.match(route, /^\s+if \(frameCache\.missed\(upstreamPath\)\)/m);
  assert.match(route, /^\s+frameCache\.markMiss\(upstreamPath\);/m);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const src = readFileSync(new URL("../components/kiosk/kiosk-display.tsx", import.meta.url), "utf8");
const hook = src.slice(src.indexOf("export function useWeatherView"), src.indexOf("/* ── briefing contract"));

it("polish 34: the weather hook stamps every good fetch and passes the age", () => {
  assert.match(hook, /onSuccess/);
  assert.match(hook, /status === "ok"/);
  assert.match(hook, /lastOkAgeMs/);
  assert.match(hook, /useNow\(true, true\)/);
});

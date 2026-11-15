import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The route imports "@/" and can't load under node:test, so scan its source (like secret-origin.test.ts).
const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("the calendar check and fetch finish before the config is loaded for the save", () => {
  const prepare = src.indexOf("await prepareCalendar(");
  const load = src.indexOf("loadConfigForSave()");
  assert.ok(prepare > 0 && load > 0);
  assert.ok(prepare < load, "a slow calendar fetch must not sit between the config load and its save");
});

test("the calendar cache changes only after the config is saved, and no reply carries the link", () => {
  assert.ok(src.indexOf("saveConfig(next)") < src.indexOf("commitCalendar("));
  assert.doesNotMatch(src, /calendar\??\.url/);
  assert.doesNotMatch(src, /console\.\w+\([^)]*calendar/i);
});

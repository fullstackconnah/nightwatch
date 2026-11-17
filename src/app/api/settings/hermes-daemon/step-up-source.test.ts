import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The route imports "@/" and can't load under node:test without a hook, so scan its source (LF-normalised).
const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const at = (needle: string) => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `missing: ${needle}`);
  return i;
};

test("the gate sits after the last field 400 and before the write", () => {
  const gate = at("checkCurrentPassword(");
  assert.ok(at("budgetChangeError(") < gate);
  assert.ok(at("must be an integer 0-59") < gate);
  assert.ok(gate < at("writeHermesSettingsFile(next)"));
});

test("it asks with the route's trimmed values, never the raw body", () => {
  const call = src.slice(at("discordStepUpNeeded(\n"), at("checkCurrentPassword("));
  assert.match(call, /botToken: str\(body\.discordBotToken\)/);
  assert.match(call, /allowedUserIds: typedUserIds/);
  assert.doesNotMatch(call, /body\.discordAllowedUserIds/);
});

test("the three tagged answers, the 409 re-read and no 401", () => {
  assert.match(src, /Enter your current password to change this\.[^]{0,80}status: 400/);
  assert.match(src, /Too many attempts\. Wait a minute and try again\.[^]{0,80}status: 429/);
  assert.match(src, /Current password is incorrect\.[^]{0,80}status: 403/);
  assert.match(src, /Settings changed while the password was checked\. Nothing was saved; try again\.[^]{0,80}status: 409/);
  assert.ok(at("isDeepStrictEqual(fresh, raw)") < at("writeHermesSettingsFile(next)"));
  assert.doesNotMatch(src, /status: 401/);
});

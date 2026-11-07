import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const route = readFileSync(
  fileURLToPath(new URL("../app/kiosk/api/ha/action/route.ts", import.meta.url)),
  "utf8",
);

test("kiosk action route checks the hidden list through the helper", () => {
  assert.match(route, /getHiddenSettingsIds/);
  assert.match(route, /kioskActionRefusal\(/);
});

test("kiosk action route never returns HA's raw detail to the caller, and logs it", () => {
  assert.doesNotMatch(route, /result\.detail\s*\?\?/);
  assert.match(route, /console\.error\([^)]*result\.detail/);
  assert.match(route, /error: "Home Assistant action failed"/);
});

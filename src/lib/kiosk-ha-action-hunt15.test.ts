import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const route = readFileSync(
  fileURLToPath(new URL("../app/kiosk/api/ha/action/route.ts", import.meta.url)),
  "utf8",
);

test("kiosk action route checks the hidden list through the helper", () => {
  assert.match(route, /^\s+const refusal = kioskActionRefusal\(parsed\.entityId, hidden\);\s*$/m);
  assert.match(route, /^\s+if \(refusal === "hidden"\) return validationError/m);
  assert.match(route, /^\s+const hidden = await getHiddenSettingsIds\(\)/m);
});

const voice = readFileSync(
  fileURLToPath(new URL("../app/kiosk/api/assistant/route.ts", import.meta.url)),
  "utf8",
);
test("kiosk voice route filters entities through the hidden list", () => {
  assert.match(voice, /^\s+getHiddenSettingsIds\(\)/m);
  assert.match(voice, /^\s+const entities = .*kioskVoiceEntities\(/m);
});

test("kiosk action route never returns HA's raw detail to the caller, and logs it", () => {
  assert.doesNotMatch(route, /result\.detail\s*\?\?/);
  assert.match(route, /console\.error\([^)]*result\.detail/);
  assert.match(route, /error: "Home Assistant action failed"/);
});

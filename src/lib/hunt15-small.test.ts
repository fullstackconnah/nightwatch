import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { climatesToTurnOff, gaveUpForWindow } from "./kiosk/auto-off-targets.ts";

// Modules behind the "@/" alias cannot load under node:test, so they are source-scanned.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

test("A2: activate waits SLOW_MS because a switch stops and starts the server", () => {
  assert.match(read("lib/minecraft/manager.ts"), /\/activate`, \{[^}]*timeoutMs: SLOW_MS/);
});

test("A4: rcon keeps 4 s for connect+login and starts a fresh 15 s timer for the command reply", () => {
  const src = read("lib/minecraft/rcon.ts");
  assert.match(src, /opts\.timeoutMs \?\? 4000/);
  assert.match(src, /COMMAND_REPLY_MS = 15_000/);
  assert.match(src, /authed = true;[\s\S]{0,200}clearTimeout\(overall\);[\s\S]{0,100}overall = setTimeout\([\s\S]{0,100}COMMAND_REPLY_MS/);
});

test("A7: upload forwards the parsed memoryGb, never the raw string", () => {
  const src = read("app/api/minecraft/instances/upload/route.ts");
  assert.match(src, /query\.set\("memoryGb", String\(Number\(memoryGb\)\)\)/);
  assert.doesNotMatch(src, /query\.set\("memoryGb", memoryGb\)/);
});

test("A9: pack search caps q at 100 characters before it goes upstream", () => {
  const src = read("app/api/minecraft/packs/search/route.ts");
  assert.match(src, /searchPacks\(q\.slice\(0, 100\), source\)/);
});

test("B4: auto-off targets only available units that are not already off", () => {
  const cs = [
    { entityId: "climate.fake_on", available: true, hvacMode: "cool" },
    { entityId: "climate.fake_off", available: true, hvacMode: "off" },
    { entityId: "climate.fake_gone", available: false, hvacMode: "unavailable" },
  ];
  assert.deepEqual(climatesToTurnOff(cs).map((c) => c.entityId), ["climate.fake_on"]);
});

test("B4: the hook uses the helper at both places", () => {
  const src = read("lib/kiosk/use-climate-auto-off.ts");
  assert.equal(src.match(/climatesToTurnOff\(/g)?.length, 2);
  assert.doesNotMatch(src, /hvacMode !== "off"/);
});

test("B2: once gave up for a dateKey, that date is skipped but a new day works", () => {
  assert.equal(gaveUpForWindow("2026-11-08", "2026-11-08"), true);
  assert.equal(gaveUpForWindow("2026-11-08", "2026-11-09"), false);
  assert.equal(gaveUpForWindow(null, "2026-11-08"), false);
});

test("B2: the hook records the give-up and skips further attempts", () => {
  const src = read("lib/kiosk/use-climate-auto-off.ts");
  assert.match(src, /gaveUpRef\.current = win\.dateKey/);
  assert.match(src, /gaveUpForWindow\(gaveUpRef\.current, win\.dateKey\)/);
});

test("B3: the header comment states the double-fire guard only holds once the marker has landed", () => {
  assert.match(read("lib/kiosk/use-climate-auto-off.ts"), /once the marker has landed/);
});

test("B5: useKioskHa pauses the poll on pendingIds, not a paused boolean", () => {
  const src = read("components/kiosk/kiosk-hub.tsx");
  assert.doesNotMatch(src, /setPaused|\[paused,/);
  assert.match(src, /refreshInterval: pendingIds\.size > 0 \? 0 : pollMs/);
});

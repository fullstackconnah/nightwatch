import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("downloads route: an unreachable qBittorrent answers 502 so the tablet keeps its last list", () => {
  const route = src("../app/kiosk/api/downloads/route.ts");
  assert.match(route, /status === "unreachable"/);
  assert.match(route, /status:\s*502/);
});

test("downloads button: a retained list is marked stale on the corner button too", () => {
  const dl = src("../components/kiosk/kiosk-downloads.tsx");
  assert.match(dl, /<KioskDownloadsButton[^>]*stale=\{!!error\}/);
  assert.match(dl, /last known, downloads are unavailable right now/);
  assert.match(dl, /stale && count > 0/);
});

test("radar: a non-OK answer throws into the existing fetchFailed path", () => {
  const radar = src("../components/kiosk/kiosk-radar.tsx");
  assert.match(radar, /if \(!res\.ok\) throw/);
});

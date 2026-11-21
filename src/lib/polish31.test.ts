import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("downloads route: an unreachable qBittorrent answers 502 so the tablet keeps its last list", () => {
  const route = src("../app/kiosk/api/downloads/route.ts");
  assert.match(route, /status === "unreachable"/);
  assert.match(route, /error: "downloads unavailable" \},\s*\{ status: 502 \}/);
  // the tray's stale tag is driven by the SWR error that the 502 raises
  assert.match(src("../components/kiosk/kiosk-downloads.tsx"), /stale=\{!!error\}/);
});

test("radar: a non-OK answer throws into the existing fetchFailed path", () => {
  const radar = src("../components/kiosk/kiosk-radar.tsx");
  assert.match(radar, /fetch\("\/kiosk\/api\/weather\/radar"\)\s*\.then\(\(res\) => \{\s*if \(!res\.ok\) throw new Error\([^)]*\);\s*return res\.json\(\) as Promise<RadarApiResponse>;/);
});

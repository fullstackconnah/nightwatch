import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const src = (rel: string) => readFileSync(path(rel), "utf8");

test("alerts: the attention poll's error marks the button stale", () => {
  const alerts = src("../components/kiosk/kiosk-alerts.tsx");
  assert.match(alerts, /^\s+const \{ data, error \} = useSWR<AttentionResult>/m);
  assert.match(alerts, /^\s+stale: boolean;/m);
  // absolute wrapper keeps the button width fixed (the downloads button offset assumes it)
  assert.match(alerts, /\{stale && \(\s*<span className="absolute [^"]*">\s*<StaleTag \/>/);
});

test("vitals: old numbers stay on a failed poll, marked by useFreshness", () => {
  const vitals = src("../components/kiosk/kiosk-vitals.tsx");
  assert.match(vitals, /^import \{[^}]*\buseFreshness\b[^}]*\} from "@\/lib\/kiosk-client";/m);
  assert.match(vitals, /^\s+if \(freshness\.status === "unreachable-empty"\)/m);
  assert.match(vitals, /^\s+<div className="microlabel[^"]*">network \{stale && <StaleTag \/>\}<\/div>/m);
});

test("downloads: the tray shows StaleTag for an error with old data", () => {
  const dl = src("../components/kiosk/kiosk-downloads.tsx");
  assert.match(dl, /^\s+\{stale && .*<StaleTag \/>/m);
  assert.match(dl, /^\s+const \{ data, error \} = useKioskDownloads\(\);/m);
});

test("dead KioskHealth component is gone", () => {
  assert.equal(existsSync(path("../components/kiosk/kiosk-health.tsx")), false);
  assert.doesNotMatch(src("../components/kiosk/kiosk-admin-panel.tsx"), /see KioskHealth/);
});

test("admin panel clears its 4s timers on unmount", () => {
  const panel = src("../components/kiosk/kiosk-admin-panel.tsx");
  assert.match(panel, /^\s+useEffect\(\(\) => \(\) => clearTimeout\(timerRef\.current\), \[\]\);/m);
  assert.doesNotMatch(panel, /^\s+setTimeout\(/m);
});

test("error.tsx header describes the 5-minute window", () => {
  assert.match(src("../app/kiosk/error.tsx"), /wait out the 5-minute window/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const pill = read("../components/kiosk/kiosk-now-playing.tsx");
test("A1: the now-playing pill is inactive while its poll errors", () => {
  assert.match(pill, /^\s+const \{ data, error \} = useKioskNowPlaying\(pollMs\);\s*$/m);
  assert.match(pill, /^\s+const active: NowPlayingActive \| null = !error && data\?\.status === "ok" \? data : null;\s*$/m);
});

test("A5: the enter effect re-runs when active returns during the fade", () => {
  assert.match(pill, /^\s+if \(!mounted \|\| !active\) return;\s*$/m);
  assert.match(pill, /^\s+\}, \[mounted, active\]\);\s*$/m);
});

const client = read("./kiosk-client.ts");
test("A1: keepPreviousData comment no longer promises the pill survives a missed poll", () => {
  assert.doesNotMatch(client, /single missed poll doesn't flash the pill/);
});

const ha = read("./ha.ts");
test("A6: ha numberOrNull rejects null, undefined and empty string", () => {
  assert.match(ha, /^\s+if \(value == null \|\| value === ""\) return null;\s*$/m);
});

const charts = read("../components/charts.tsx");
test("B6: Meter and Gauge clamp a non-finite percent to 0", () => {
  const hits = charts.match(/^\s+const p = Number\.isFinite\(percent\) \? Math\.max\(0, Math\.min\(100, percent\)\) : 0;\s*$/gm) ?? [];
  assert.equal(hits.length, 2);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./use-voice.ts", import.meta.url)), "utf8");

test("transcript callback is guarded by the mounted ref", () => {
  assert.match(src, /^\s+if \(!mountedRef\.current\) return;[^\n]*\n\s+onTranscriptRef\.current\(/m);
});

test("speak returns before creating Audio once unmounted", () => {
  assert.match(src, /^\s+if \(!mountedRef\.current\) return;\s*\n\s+const url = URL\.createObjectURL\(blob\);\s*\n\s+const audio = new Audio\(/m);
});

test("pipeline cleanup pauses and clears its audio", () => {
  assert.match(src, /^\s+audioRef\.current\?\.pause\(\);\s*\n\s+audioRef\.current = null;/m);
  assert.match(src, /^\s+mountedRef\.current = false;/m);
});

test("start stops the new stream's tracks when unmounted during the permission prompt", () => {
  assert.match(
    src,
    /await navigator\.mediaDevices\.getUserMedia\([^)]*\);\s*\n\s+if \(!mountedRef\.current\) \{\s*\n\s+stream\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\);\s*\n\s+return;/m,
  );
});

test("useVoiceConfigured does not use the redirecting shared fetcher", () => {
  assert.doesNotMatch(src, /^import \{ fetcher \}/m);
  assert.doesNotMatch(src, /"\/api\/voice\/status", fetcher/);
});

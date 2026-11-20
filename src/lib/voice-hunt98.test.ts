import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Hunt 98: one answer at a time, honest playback and server-down copy.
// use-voice.ts (a hook) and voice.ts (the "@/" alias) can't be imported under node:test, so these pin the source.
const read = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
const hook = read("./use-voice.ts");
const voice = read("./voice.ts");

const STOP = /const stopSpeaking = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/;
const SPEAK = /const speak = useCallback\(async[\s\S]*?\n  \}, \[stopSpeaking\]\);/;

test("stopSpeaking pauses, revokes the object url, nulls both refs and clears speaking", () => {
  const body = STOP.exec(hook)?.[1] ?? "";
  assert.match(body, /audioRef\.current\?\.pause\(\);/);
  assert.match(body, /if \(audioUrlRef\.current\) URL\.revokeObjectURL\(audioUrlRef\.current\);/);
  assert.match(body, /audioRef\.current = null;/);
  assert.match(body, /audioUrlRef\.current = null;/);
  assert.match(body, /setSpeaking\(false\);/);
});

test("speak stops the previous playback before it creates the new Audio", () => {
  const body = SPEAK.exec(hook)?.[0] ?? "";
  const stop = body.indexOf("stopSpeaking();");
  assert.ok(stop > 0, "speak calls stopSpeaking()");
  assert.ok(stop < body.indexOf("new Audio("), "...before new Audio(");
});

test("tapping the mic stops the answer first, then starts the recorder", () => {
  assert.match(hook, /state !== "asking"\) \{\s*\n\s+stopSpeaking\(\);[^\n]*\n\s+void recorder\.start\(\);/);
});

test("a replaced audio's cleanup cannot clear the new answer's speaking flag", () => {
  const body = SPEAK.exec(hook)?.[0] ?? "";
  assert.match(body, /if \(audioRef\.current === audio\) \{[^}]*setSpeaking\(false\);/);
  assert.doesNotMatch(body, /const cleanup = \(\) => \{\s*\n\s+setSpeaking\(false\);/);
});

test("a refused play() says so, but only when this audio is still the current one", () => {
  const body = SPEAK.exec(hook)?.[0] ?? "";
  assert.match(
    body,
    /audio\.play\(\)\.catch\(\(\) => \{\s*\n(?:\s*\/\/[^\n]*\n)?\s+if \(audioRef\.current === audio\) setPipelineError\("Could not play the answer aloud\."\);\s*\n\s+cleanup\(\);/,
  );
  assert.match(body, /setPipelineError\("Could not reach the speech service\."\)/); // outer catch unchanged
});

test("voice.ts tells a timeout from any other transport failure", () => {
  const fn = /function unreachableDetail\(([^)]*)\): string \{([\s\S]*?)\n\}/.exec(voice);
  assert.ok(fn, "unreachableDetail exists");
  assert.match(fn[1], /e: unknown/);
  assert.match(fn[2], /isTimeout\(e\)/);
  assert.match(fn[2], /Voice server did not respond within \$\{TIMEOUT_MS \/ 1000\}s\./); // timeout text unchanged
  assert.match(fn[2], /Voice server is not reachable\./);
  assert.match(voice, /import \{ isTimeout \} from "@\/lib\/integration-client";/);
});

test("both fetch catches (transcribe and speak) pass their error on", () => {
  assert.equal((voice.match(/\} catch \(e\) \{\s*\n\s+return \{ status: "unreachable", detail: unreachableDetail\(e\) \};/g) ?? []).length, 2);
  assert.doesNotMatch(voice, /unreachableDetail\(\)/);
});

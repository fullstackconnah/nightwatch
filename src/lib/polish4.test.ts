import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Hooks and pages cannot be imported under node:test (React, "@/" alias), so these pin the source.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const page = () => read("../app/(dash)/networks/page.tsx");
const voice = () => read("./use-voice.ts");
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `missing ${from}`);
  const b = src.indexOf(to, a);
  return src.slice(a, b < 0 ? undefined : b);
};

test("BridgeRow: below md the text block and the readout each take the full row, md keeps one column", () => {
  const row = between(page(), "function BridgeRow(", "interface FootprintRow");
  assert.match(row, /<div className="min-w-0 col-span-2 md:col-span-1">\s*\n\s*<div className="flex items-baseline/);
  assert.match(row, /<div className="col-span-2 md:col-span-1 text-right shrink-0">/);
});

test("ContainerFootprint: both sides compare a mean rate; a row with no samples falls back to its own current rx + tx", () => {
  const src = page();
  const foot = between(src, "return [...groups.values()]", "const total = rows.reduce");
  assert.match(foot, /windowMean\(b\.id\) \|\| b\.rx \+ b\.tx/);
  assert.match(foot, /windowMean\(a\.id\) \|\| a\.rx \+ a\.tx/);
  assert.match(foot, /localeCompare/);
  // the window value is a sum divided by the id's OWN sample count, so it is the same unit as one rate
  const mean = between(src, "const windowMean", "return [...groups.values()]");
  assert.match(mean, /samples\.filter\(\(s\) => s\.containers\[id\]\)/);
  assert.match(mean, /\/ \(own\.length \|\| 1\)/);
  assert.doesNotMatch(mean, /samples\.length/);
});

test("speak clears a stale pipeline error before it fetches", () => {
  const speak = between(voice(), "const speak = useCallback(", "const handleTranscript");
  const clear = speak.indexOf("setPipelineError(null)");
  assert.ok(clear >= 0 && clear < speak.indexOf("fetch("));
});

test("speak: only the newest call plays; stopSpeaking invalidates a pending one", () => {
  const src = voice();
  const speak = between(src, "const speak = useCallback(", "const handleTranscript");
  assert.match(speak, /const seq = \+\+speakSeqRef\.current;/);
  const blob = speak.indexOf("await res.blob()");
  const stale = speak.indexOf("seq !== speakSeqRef.current", blob);
  const teardown = speak.indexOf("stopPlayback()", blob); // from the blob on: the pre-blob failure paths call it too (polish7)
  // post-blob stale check, then the teardown helper, then the new Audio
  assert.ok(blob >= 0 && stale > blob && teardown > stale && teardown < speak.indexOf("new Audio("));
  // the check after res.json() is pinned too, before it reports the server's detail
  const json = speak.indexOf("res.json()");
  const afterJson = speak.indexOf("seq !== speakSeqRef.current", json);
  assert.ok(json >= 0 && afterJson > json && afterJson < speak.indexOf("setPipelineError(data.detail"));
  // the first await (the fetch) is checked too
  const afterFetch = speak.indexOf("seq !== speakSeqRef.current");
  assert.ok(afterFetch > speak.indexOf("await fetch(") && afterFetch < blob);
  assert.match(between(src, "const stopSpeaking = useCallback(", "const speak = useCallback("), /speakSeqRef\.current\+\+/);
});

test("speak replaces playing audio with a teardown that does not bump the counter", () => {
  const src = voice();
  const speak = between(src, "const speak = useCallback(", "const handleTranscript");
  assert.doesNotMatch(speak, /stopSpeaking\(/); // calling stopSpeaking would make this very call stale
  const helper = between(src, "const stopPlayback = useCallback(", "const stopSpeaking = useCallback(");
  assert.doesNotMatch(helper, /speakSeqRef/);
  assert.match(helper, /audioRef\.current\?\.pause\(\)/);
  assert.match(helper, /setSpeaking\(false\)/);
  assert.match(between(src, "const stopSpeaking = useCallback(", "const speak = useCallback("), /speakSeqRef\.current\+\+;[\s\S]*stopPlayback\(\);/);
});

test("speak: a throw after the blob is read says the audio failed; a fetch throw says the service is unreachable", () => {
  const speak = between(voice(), "const speak = useCallback(", "const handleTranscript");
  const blob = speak.indexOf("await res.blob()");
  const flag = speak.indexOf("afterBlob = true");
  assert.ok(blob >= 0 && flag > speak.indexOf("seq !== speakSeqRef.current", blob) && flag < speak.indexOf("stopPlayback()", blob));
  assert.match(speak, /let afterBlob = false;/);
  assert.match(speak, /if \(seq === speakSeqRef\.current\) \{\s*\n(?:\s*\/\/[^\n]*\n)?\s+stopPlayback\(\);[^\n]*\n\s+setPipelineError\(afterBlob \? "Could not play the answer aloud\." : "Could not reach the speech service\."\);/);
});

test("awaitingSpeech: only the newest answer's speak clears the flag; stopping does not touch the counter", () => {
  const src = voice();
  assert.match(src, /const awaitingSeqRef = useRef\(0\);/);
  const effect = between(src, "setAwaitingSpeech(true);", "return;");
  assert.match(effect, /const mine = \+\+awaitingSeqRef\.current;/);
  assert.ok(effect.indexOf("const mine") < effect.indexOf("void speak("));
  assert.match(effect, /if \(awaitingSeqRef\.current === mine\) setAwaitingSpeech\(false\)/);
  const stops = between(src, "const stopPlayback = useCallback(", "const speak = useCallback(");
  assert.doesNotMatch(stops, /awaitingSeqRef/);
});

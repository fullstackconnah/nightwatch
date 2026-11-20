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

test("ContainerFootprint: a row with no window samples sorts by its own current rx + tx", () => {
  const foot = between(page(), "return [...groups.values()]", "const total = rows.reduce");
  assert.match(foot, /windowTotal\(b\.id\) \|\| b\.rx \+ b\.tx/);
  assert.match(foot, /windowTotal\(a\.id\) \|\| a\.rx \+ a\.tx/);
  assert.match(foot, /localeCompare/);
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
  assert.ok(blob >= 0 && stale > blob && stale < speak.indexOf("new Audio("));
  // the first await (the fetch) is checked too
  const afterFetch = speak.indexOf("seq !== speakSeqRef.current");
  assert.ok(afterFetch > speak.indexOf("await fetch(") && afterFetch < blob);
  assert.match(between(src, "const stopSpeaking = useCallback(", "const speak = useCallback("), /speakSeqRef\.current\+\+/);
});

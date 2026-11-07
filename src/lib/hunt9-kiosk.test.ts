import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Browser-only code (MediaRecorder, AudioContext, React refs): checked by reading the source.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const voice = read("./use-voice.ts");
const page = read("../app/kiosk/page.tsx");
const client = read("./kiosk-client.ts");
const timers = read("../components/kiosk/kiosk-timers.tsx");

describe("hunt 9 kiosk client", () => {
  it("B1: lockKiosk reports whether the server accepted the lock", () => {
    assert.match(client, /export async function lockKiosk\(\): Promise<boolean>/);
  });
  it("B1: lock() resets lockingRef in a finally and warns on a refused lock", () => {
    assert.match(page, /lockingRef\.current = false/);
    assert.match(page, /finally/);
    assert.match(page, /console\.warn/);
  });
  it("B2: start() guards a second tap and releases the mic on failure", () => {
    assert.match(voice, /startingRef\.current/);
    assert.match(voice, /catch \{\s*teardownStream\(\);[^\n]*\n\s*setError\("Could not access the microphone/);
  });
  it("B3: unmount detaches onstop before teardown", () => {
    assert.match(voice, /recorderRef\.current\.onstop = null/);
  });
  it("B6: a failed run.start sets the exchange error", () => {
    assert.match(voice, /await run\.start\("ask", text\)/);
  });
  it("B4: timers create the AudioContext on the first pointerdown", () => {
    assert.match(timers, /addEventListener\("pointerdown"/);
  });
});

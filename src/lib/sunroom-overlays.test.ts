/* Sunroom overlays (Sill DS PR 3): the pure helpers and the static checks that need no browser (N8, N12, N13, F2, F5). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHIME_GAP_MS, chimeDue, playChime, releaseVelocity, rubberband, sheetDragY, shouldDismiss, unlockAudio } from "./sunroom-overlays.ts";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

describe("rubberband and sheet drag (bundle.js:287, :450)", () => {
  it("rubberband resists: always shorter than the pull, bounded by the sheet height", () => {
    assert.equal(rubberband(0, 600), 0);
    assert.ok(Math.abs(rubberband(-100, 600)) < 100);
    assert.ok(Math.abs(rubberband(-100000, 600)) < 600);
  });
  it("a downward drag tracks 1:1; an upward one is rubber-banded", () => {
    assert.equal(sheetDragY(120, 600), 120);
    assert.equal(sheetDragY(-120, 600), rubberband(-120, 600));
  });
  it("shouldDismiss: past 40% of the height, or a quick downward flick; never upward", () => {
    assert.equal(shouldDismiss(241, 600, 0), true);
    assert.equal(shouldDismiss(239, 600, 0), false);
    assert.equal(shouldDismiss(30, 600, 0.12), true);
    assert.equal(shouldDismiss(-300, 600, 0.5), false);
    assert.equal(shouldDismiss(0, 600, 0.5), false);
  });
  it("releaseVelocity: px per ms over the last samples; a finger that paused before lifting has none", () => {
    assert.equal(releaseVelocity([[0, 0], [100, 50]], 120), 0.5);
    assert.equal(releaseVelocity([[0, 0], [100, 50]], 300), 0);
    assert.equal(releaseVelocity([[10, 5]], 12), 0);
  });
});

describe("chime (Alert, bundle.js:534-553)", () => {
  it("is due the first time and then at most every 30 s", () => {
    assert.equal(CHIME_GAP_MS, 30000);
    assert.equal(chimeDue(null, 5), true);
    assert.equal(chimeDue(1000, 30999), false);
    assert.equal(chimeDue(1000, 31000), true);
  });
  it("never throws and plays nothing when Web Audio is missing or locked", () => {
    assert.doesNotThrow(() => unlockAudio());
    assert.equal(playChime(), false);
  });
});

describe("F2: no blur under Sunroom (rule 6, N19)", () => {
  const css = noComments(read("src/app/kiosk/sunroom/overlays.css"));
  it("every element under the scope has no backdrop-filter", () => {
    assert.match(css, /\[data-kiosk-theme="sunroom"\] \*[^{]*\{[^}]*backdrop-filter:\s*none/);
  });
  it(".kiosk-defocus dims without a filter, and its transition names no filter", () => {
    assert.match(css, /\.kiosk-defocus[^{]*\{[^}]*filter:\s*none/);
  });
});

describe("F5: overlay titles use the DS title style through the type tokens", () => {
  const css = noComments(read("src/app/kiosk/sunroom/overlays.css"));
  it("[data-sr-title] reads --sr-type-title; group headings read --sr-type-micro", () => {
    assert.match(css, /\[data-sr-title\]\s*\{[^}]*font:\s*var\(--sr-type-title\)/);
    assert.match(css, /\[data-sr-group\]\s*\{[^}]*font:\s*var\(--sr-type-micro\)/);
  });
  it("no hex literals in overlays.css", () => assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/));
});

describe("N12 static: nothing that updates more than once a minute is transitioned in overlays.css", () => {
  const css = noComments(read("src/app/kiosk/sunroom/overlays.css"));
  it("no rule that selects [data-sr-live] declares a transition or animation", () => {
    const bad = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel, body]) => /data-sr-live/.test(sel) && /(transition|animation)\s*:(?!\s*none)/.test(body));
    assert.deepEqual(bad.map((b) => b[1].trim()), []);
  });
  it("the timer ring and its arc have no transition under Sunroom", () => {
    assert.match(css, /\.sr-ring-arc[^{]*\{[^}]*transition:\s*none/);
  });
});

describe("N13 / host: every overlay mounts through the one host", () => {
  const files = ["kiosk-climate-auto-off", "kiosk-climate-modal", "kiosk-timers", "kiosk-downloads", "kiosk-alerts", "kiosk-doorbell", "kiosk-radar", "kiosk-pin-pad"];
  for (const f of files) {
    it(`${f}.tsx wraps its overlay in KioskPortal`, () => assert.match(read(`src/components/kiosk/${f}.tsx`), /<KioskPortal>/));
  }
  it("the theme scope renders the host as its own child, not on body", () => {
    const t = read("src/components/kiosk/kiosk-theme.tsx");
    assert.match(t, /<OverlayHostProvider enabled=\{theme === "sunroom"\}>/);
    const h = read("src/components/kiosk/kiosk-overlay-host.tsx");
    assert.match(h, /data-sr-overlay-host/);
    assert.doesNotMatch(h, /document\.body/);
  });
  it("no overlay file still carries a backdrop blur class without the Sunroom override in place", () => {
    assert.match(noComments(read("src/app/kiosk/sunroom/overlays.css")), /backdrop-filter:\s*none/);
  });
});

describe("PinPad keeps every guard (security surface, OPEN-S1)", () => {
  const pin = read("src/components/kiosk/kiosk-pin-pad.tsx");
  it("the submit guard, the lockout countdown and the busy/locked key guard are all still there", () => {
    assert.match(pin, /if \(submittingRef\.current\) return;/);
    assert.match(pin, /submitKioskPin\(pin\)/);
    assert.match(pin, /if \(result\.lockedUntil\) setLockedUntil\(result\.lockedUntil\)/);
    assert.match(pin, /if \(busy \|\| lockedUntil !== null \|\| !key\) return;/);
    assert.match(pin, /disabled=\{busy \|\| lockedUntil !== null\}/);
    assert.match(pin, /Too many attempts/);
  });
  it("the status line carries its tone for N18", () => assert.match(pin, /data-sr-tone="warn"/));
});

describe("Alert: the chime plays under Sunroom only", () => {
  const a = read("src/components/kiosk/kiosk-alerts.tsx");
  it("playChime is called behind the Sunroom check, and the first touch unlocks audio", () => {
    assert.match(a, /sunroom\) playChime\(\)/);
    assert.match(a, /useChimeUnlock\(\)/);
  });
});

/* Sunroom controls (Sill DS PR 2): the pure helpers and the static checks that need no browser (N8, N12 static scan). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catchOrigin, chipWord, showSub } from "./sunroom-controls.ts";

describe("catchOrigin (bundle.js aimCatch)", () => {
  it("puts the disc's origin under the finger: the disc's box starts at (-0.3w, h/2 - 0.8w) in the lit layer", () => {
    // lit layer 200x56 at (100,50); finger at its centre (200,78)
    assert.equal(catchOrigin({ left: 100, top: 50, width: 200, height: 56 }, 200, 78), "160px 160px");
  });
  it("a missing touch point clears the origin", () => {
    assert.equal(catchOrigin({ left: 0, top: 0, width: 10, height: 10 }, null, null), "");
  });
});

describe("chipWord", () => {
  it("on and off", () => {
    assert.deepEqual(chipWord({ on: true }), { word: "On" });
    assert.deepEqual(chipWord({ on: false }), { word: "Off" });
  });
  it("an error word carries the bad tone and wins over on/off", () => {
    assert.deepEqual(chipWord({ on: true, error: true }), { word: "Error", tone: "bad" });
  });
  it("busy shows its own word", () => {
    assert.deepEqual(chipWord({ on: false, busy: true }), { word: "Working" });
  });
});

describe("scene chips have no on/off word (round 4, F3b)", () => {
  it("a scene shows no word at rest, activated or busy; an error still has its word", () => {
    assert.deepEqual(chipWord({ on: false, scene: true }), { word: "" });
    assert.deepEqual(chipWord({ on: true, scene: true }), { word: "" });
    assert.deepEqual(chipWord({ on: false, scene: true, busy: true }), { word: "" });
    assert.deepEqual(chipWord({ on: false, scene: true, error: true }), { word: "Error", tone: "bad" });
  });
});

describe("showSub: the sublabel is dropped when it repeats the state word (round 4, F3a)", () => {
  it("drops on/off in any case or padding", () => {
    assert.equal(showSub(" Off ", "Off"), false);
    assert.equal(showSub("on", "On"), false);
  });
  it("keeps richer text, and always keeps an error", () => {
    assert.equal(showSub("60%", "On"), true);
    assert.equal(showSub("on", "Error"), true);
  });
});

describe("N12 static: nothing that updates more than once a minute is transitioned", () => {
  const css = readFileSync(join(process.cwd(), "src/app/kiosk/sunroom/controls.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("no controls.css rule that selects [data-sr-live] declares a transition or animation", () => {
    const bad = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel, body]) => /data-sr-live/.test(sel) && /(transition|animation)\s*:(?!\s*none)/.test(body));
    assert.deepEqual(bad.map((m) => m[1].trim()), []);
  });
});

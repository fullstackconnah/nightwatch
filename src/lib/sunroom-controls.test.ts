/* Sunroom controls (Sill DS PR 2): the pure helpers and the static checks that need no browser (N8, N12 static scan). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catchOrigin, chipWord, showSub } from "./sunroom-controls.ts";
import { SUNROOM_STOPS, sunroomCssVars, sunroomStateAt } from "./sunroom-light.ts";

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

describe("Glaze: a chip that is on rests on --sr-on-rest, not the full sunlit face", () => {
  const css = readFileSync(join(process.cwd(), "src/app/kiosk/sunroom/controls.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = () => [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
  const onChipLit = () => rules().find((r) => /sr-chip\[role="switch"\]\[aria-checked="true"\] \.sr-lit/.test(r.sel) && r.body.includes("on-rest"));
  const WANT: Record<string, string> = { dawn: "0.28", morning: "0.18", midday: "0.18", golden: "0.24", dusk: "0.5", night: "0.32" };

  it("on-rest exists at every stop with the contrast-table value", () => {
    for (const [i, s] of SUNROOM_STOPS.entries()) {
      assert.equal(sunroomCssVars(sunroomStateAt(i), s.light)["--sr-on-rest"], WANT[s.name], s.name);
    }
  });
  it("on-rest lerps between stops like sunlit", () => {
    const v = Number(sunroomCssVars(sunroomStateAt(4.5), SUNROOM_STOPS[4].light)["--sr-on-rest"]); // golden to dusk
    assert.ok(v > 0.24 && v < 0.5, String(v));
  });
  it("the resting ON chip face is the glaze, and the full light only shows during the bloom", () => {
    assert.match(onChipLit()?.body ?? "", /opacity:\s*var\(--sr-on-rest\)/);
    const base = rules().find((r) => /button\.sr-chip\[role="switch"\] \.sr-lit$/.test(r.sel));
    assert.match(base?.body ?? "", /opacity:\s*1/);
  });
  it("disabled ON shows no light and ink-faint pip and word", () => {
    const lit = rules().find((r) => /button\.sr-chip\[role="switch"\]:disabled \.sr-lit/.test(r.sel));
    assert.match(lit?.body ?? "", /opacity:\s*0/);
    assert.match(css, /button\.sr-chip\[role="switch"\]:disabled:is\([^)]*\) \.sr-pip\s*\{[^}]*--sr-ink-faint/);
    assert.match(css, /button\.sr-chip\[role="switch"\]:disabled:is\([^)]*\) \.sr-state\s*\{[^}]*--sr-ink-faint/);
  });
  it("reduced motion lands on the glaze with no .sr-lit transition", () => {
    const rm = css.slice(css.indexOf("prefers-reduced-motion"));
    assert.match(rm, /\[data-lit="true"\] \.sr-lit\s*\{[^}]*transition:\s*none/);
  });
  it("the glaze reaches the hub toggle chip only: never a bare button.sr-chip (theme, font, pill, scene keep main)", () => {
    const glaze = rules().filter((r) => /sr-lit|:disabled:is/.test(r.sel) && /sr-chip/.test(r.sel) && /on-rest|opacity:\s*0|transition:\s*none|ink-faint|opacity:\s*1/.test(r.body));
    assert.ok(glaze.length >= 4);
    for (const r of glaze) for (const sel of r.sel.split(",")) if (/button\.sr-chip/.test(sel)) assert.match(sel, /button\.sr-chip\[role="switch"\]/, sel.trim());
  });
  it("selection chips and the pill (aria-pressed or aria-checked without role=switch) get no resting-opacity rule", () => {
    const hit = rules().filter((r) => /on-rest/.test(r.body)).flatMap((r) => r.sel.split(","));
    assert.ok(hit.length > 0);
    for (const sel of hit) assert.match(sel, /\[role="switch"\]/, sel.trim());
  });
  it("disabled ON drops its light at once: transition none", () => {
    const lit = rules().find((r) => /\[role="switch"\]:disabled \.sr-lit/.test(r.sel));
    assert.match(lit?.body ?? "", /transition:\s*none/);
  });
  it("one indicator: the toggle chip's dot is gone in Sunroom and the hiding rule is deleted", () => {
    const hub = readFileSync(join(process.cwd(), "src/components/kiosk/kiosk-hub.tsx"), "utf8");
    assert.match(hub, /\{!sr && <span aria-hidden className=\{cn\("h-2 w-2/);
    assert.doesNotMatch(css, /sr-chip > \.dot/);
  });
});

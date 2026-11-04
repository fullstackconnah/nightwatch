/* Sunroom ambient and data (Sill DS PR 4): the pure helpers and the static checks that need no browser
   (N6 token resolution, N8 motion scan, N10 scope, N12 static scan for ambient.css). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dotsPillX, meterTone, meterWord } from "./sunroom-ambient.ts";
import { SUNROOM_STOPS, sunroomCssVars, sunroomStateAt } from "./sunroom-light.ts";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

describe("meterTone: the vitals fill goes warn then bad at the caller's thresholds", () => {
  it("below warn is ok; at warn is warn; at bad is bad", () => {
    assert.equal(meterTone(79.9, 80, 92), "ok");
    assert.equal(meterTone(80, 80, 92), "warn");
    assert.equal(meterTone(91.9, 80, 92), "warn");
    assert.equal(meterTone(92, 80, 92), "bad");
  });
  it("disk thresholds (85, 95) are honoured", () => {
    assert.equal(meterTone(84, 85, 95), "ok");
    assert.equal(meterTone(90, 85, 95), "warn");
    assert.equal(meterTone(96, 85, 95), "bad");
  });
  it("out-of-range input clamps instead of throwing", () => {
    assert.equal(meterTone(-5, 80, 92), "ok");
    assert.equal(meterTone(140, 80, 92), "bad");
  });
});

describe("meterWord: a status colour always has a word (rule 5)", () => {
  it("ok has none, warn says High, bad says Critical", () => {
    assert.equal(meterWord("ok"), "");
    assert.equal(meterWord("warn"), "High");
    assert.equal(meterWord("bad"), "Critical");
  });
});

describe("dotsPillX: the carousel pill sits on dot i of 44 px buttons", () => {
  it("is index times the hit-min size", () => {
    assert.equal(dotsPillX(0), 0);
    assert.equal(dotsPillX(3), 132);
  });
  it("a negative or fractional index folds to a whole non-negative step", () => {
    assert.equal(dotsPillX(-1), 0);
    assert.equal(dotsPillX(1.4), 44);
  });
});

describe("ambient.css static scans", () => {
  const raw = read("src/app/kiosk/sunroom/ambient.css");
  const css = strip(raw);
  const SCOPE = '[data-kiosk-theme="sunroom"]';
  // top-level and @media-nested style rules (not @keyframes bodies)
  const rules = (src: string) => {
    const out: { sel: string; body: string; rm: boolean }[] = [];
    const walk = (s: string, rm: boolean, keyframes: boolean) => {
      let i = 0;
      while (i < s.length) {
        const open = s.indexOf("{", i);
        if (open < 0) break;
        const head = s.slice(i, open).trim();
        let depth = 1, j = open + 1;
        while (j < s.length && depth) { if (s[j] === "{") depth++; else if (s[j] === "}") depth--; j++; }
        const body = s.slice(open + 1, j - 1);
        if (head.startsWith("@keyframes")) walk(body, rm, true);
        else if (head.startsWith("@media")) walk(body, rm || /prefers-reduced-motion/.test(head), keyframes);
        else if (!keyframes) out.push({ sel: head, body, rm });
        i = j;
      }
    };
    walk(src, false, false);
    return out;
  };
  const all = rules(css);

  it("exists and has rules", () => assert.ok(all.length > 20));

  it("N17 / rule 6: the attention and restarting dots stay static under Sunroom (the word carries the state)", () => {
    for (const cls of [".dot-unhealthy", ".dot-restarting"]) {
      const hit = all.filter((r) => !r.rm && r.sel.split(",").some((x) => x.trim() === `${SCOPE} ${cls}`));
      assert.ok(hit.some((r) => /animation:\s*none/.test(r.body)), `${cls} has no animation:none rule`);
    }
  });
  it("carousel pill is placed against the buttons: one relative box holds both, no fixed top guess", () => {
    const box = all.find((r) => r.sel === `${SCOPE} .sr-dots-box`);
    assert.ok(box && /position:\s*relative/.test(box.body));
    const pill = all.find((r) => r.sel === `${SCOPE} .sr-dots-pill` && !r.rm);
    assert.ok(pill && /top:\s*50%/.test(pill.body) && /margin-top:\s*-4px/.test(pill.body));
    assert.match(read("src/components/kiosk/kiosk-carousel.tsx"), /sr-dots-box/);
  });

  it("N10: every selector starts with the Sunroom scope", () => {
    const bad = all.flatMap((r) => r.sel.split(",").map((s) => s.trim())).filter((s) => !s.startsWith(SCOPE));
    assert.deepEqual(bad, []);
  });

  it("N8: transitions and animations touch only opacity, transform, translate, scale, rotate; never `all`", () => {
    const OK = /^(opacity|transform|translate|scale|rotate)$/;
    const bad: string[] = [];
    for (const r of all) {
      for (const m of r.body.matchAll(/transition(?:-property)?\s*:\s*([^;]+);/g)) {
        if (/^\s*none\s*$/.test(m[1])) continue;
        for (const part of m[1].split(/,(?![^(]*\))/)) {
          const prop = part.trim().split(/\s+/)[0];
          if (!OK.test(prop)) bad.push(`${r.sel} -> ${prop}`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  it("N8: every animated or transitioned selector has a reduced-motion rule", () => {
    const moving = all.filter((r) => !r.rm && /(transition|animation)\s*:(?!\s*none)/.test(r.body));
    assert.ok(moving.length > 0);
    const rm = new Set(all.filter((r) => r.rm).flatMap((r) => r.sel.split(",").map((s) => s.trim())));
    const bad = moving.flatMap((r) => r.sel.split(",").map((s) => s.trim())).filter((s) => !rm.has(s));
    assert.deepEqual(bad, []);
  });

  it("N8: no @property and no colour or --sr-* transitions", () => {
    assert.doesNotMatch(css, /@property/);
    assert.doesNotMatch(css, /transition[^;]*(\bcolor\b|\bbackground|[\s,:]--sr-)/);
  });

  it("N12 static: no rule that selects [data-sr-live] declares a transition or animation", () => {
    const bad = all.filter((r) => /data-sr-live/.test(r.sel) && /(transition|animation)\s*:(?!\s*none)/.test(r.body));
    assert.deepEqual(bad.map((r) => r.sel), []);
  });

  it("N6: every var(--sr-*) in ambient.css resolves to the tokens, the tick or this file", () => {
    const tokens = read("src/app/kiosk/sunroom/tokens.css");
    const defined = new Set<string>([...tokens.matchAll(/(--sr-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    for (let i = 0; i < SUNROOM_STOPS.length; i++) for (const k of Object.keys(sunroomCssVars(sunroomStateAt(i), SUNROOM_STOPS[i].light))) defined.add(k);
    for (const m of css.matchAll(/(--sr-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
    const used = [...new Set([...css.matchAll(/var\((--sr-[a-z0-9-]+)/g)].map((m) => m[1]))];
    assert.deepEqual(used.filter((u) => !defined.has(u)), []);
  });

  it("no hex literals and no backdrop-filter (N19)", () => {
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(css, /backdrop-filter\s*:\s*(?!none)/);
  });

  it("the Vitals fill is the one fast-value transition and it uses the slide curve (carried item: no ease / ease-out)", () => {
    const fill = all.find((r) => /progressbar[^,]*>\s*div$/.test(r.sel) && !r.rm);
    assert.match(fill?.body ?? "", /transition:\s*transform var\(--sr-m-slide\) var\(--sr-m-ease-out\)/);
  });

  it("a gauge ring and the now-playing progress bar do not transition (readings never animate)", () => {
    assert.ok(all.some((r) => /data-sr-gauge/.test(r.sel) && /transition:\s*none/.test(r.body)));
    assert.ok(all.some((r) => /data-sr-np/.test(r.sel) && /progress/.test(r.sel) && /transition:\s*none/.test(r.body)));
  });

  it("the radar button is a 44 px target that keeps the header's height (negative margin)", () => {
    const r = all.find((x) => /data-sr-radar/.test(x.sel) && /width/.test(x.body));
    assert.match(r?.body ?? "", /width:\s*var\(--sr-hit-min\)/);
    assert.match(r?.body ?? "", /height:\s*var\(--sr-hit-min\)/);
    assert.match(r?.body ?? "", /margin-block:\s*-/);
  });

  it("layout.tsx imports ambient.css", () => {
    assert.match(read("src/app/kiosk/layout.tsx"), /import "\.\/sunroom\/ambient\.css";/);
  });
});

describe("markup hooks (N12, N18) the shots count on", () => {
  it("the clock, readings and status are marked data-sr-live", () => {
    assert.match(read("src/components/kiosk/kiosk-clock.tsx"), /data-sr-live/);
    assert.match(read("src/components/kiosk/kiosk-vitals.tsx"), /data-sr-live/);
    assert.match(read("src/components/kiosk/kiosk-surface.tsx"), /data-sr-live/);
    assert.match(read("src/components/kiosk/kiosk-health.tsx"), /data-sr-live/);
  });
  it("status words carry data-sr-tone and a visible word", () => {
    assert.match(read("src/components/kiosk/kiosk-surface.tsx"), /data-sr-tone=\{breathing \? "ok"/);
    assert.match(read("src/components/kiosk/kiosk-vitals.tsx"), /data-sr-tone=\{/);
    assert.match(read("src/components/kiosk/kiosk-stale-tag.tsx"), /sr-stale/);
  });
  it("the sparkline glide is off under Sunroom (no motion on a reading)", () => {
    assert.match(read("src/components/kiosk/kiosk-spark.tsx"), /useKioskTheme\(\) === "sunroom"/);
  });
});

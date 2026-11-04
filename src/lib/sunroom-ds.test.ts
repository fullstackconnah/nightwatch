/* The Sunroom design-system gates that need no browser (shape brief checks N2, N5-N10).
   N1, N3, N4 live in scripts/sunroom-contrast.mjs. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SUNROOM_STOPS,
  shouldStopFade,
  sunroomCssVars,
  sunroomPress,
  sunroomShadows,
  sunroomStateAt,
} from "./sunroom-light.ts";
import { foldReelIndex, nextReelIndex } from "./sunroom-reel.ts";

const SCOPE = '[data-kiosk-theme="sunroom"]';
const DIR = join(process.cwd(), "src/app/kiosk/sunroom");
const tokens = JSON.parse(readFileSync(join(process.cwd(), "src/lib/sunroom-tokens.json"), "utf8"));
const camel = (n: string) => n.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const stopIndex = (name: string) => SUNROOM_STOPS.findIndex((s) => s.name === name);
const cssFiles = () => readdirSync(DIR).filter((f) => f.endsWith(".css"));
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
/** The stop with no live-elevation nudge (the shipped tick adds +-15% to lightY and blur; the DS samples are nudge-free). */
const atStop = (name: string) => sunroomStateAt(stopIndex(name), { elev01: 0.5 });

describe("N5 drift: the ramp's stops equal tokens.json", () => {
  for (const t of tokens.color.themes as { id: string }[]) {
    it(`${t.id}: colours and shadows are exact`, () => {
      const st = atStop(t.id);
      const pal = st.palette as unknown as Record<string, string>;
      for (const tok of tokens.color.tokens as { name: string; value: string | Record<string, string> }[]) {
        if (typeof tok.value === "string") continue; // aliases (stale, meter) are CSS-level
        assert.equal(pal[camel(tok.name)], tok.value[t.id], `${t.id} ${tok.name}`);
      }
      const sh = sunroomShadows(st.light) as Record<string, string>;
      for (const tok of tokens.shadow.tokens as { name: string; value: Record<string, string> }[]) {
        assert.equal(sh[tok.name.replace("shadow-", "")], tok.value[t.id], `${t.id} ${tok.name}`);
      }
    });
  }
  it("the press vector equals bundle.css:23-30 within 0.1 px at the six stops", () => {
    const want: Record<string, [number, number]> = {
      morning: [1.4, 1.4], dawn: [1.8, 0.9], midday: [0, 2], golden: [-1.6, 1.2], dusk: [-1.9, 0.7], night: [0, 2],
    };
    for (const [name, [x, y]] of Object.entries(want)) {
      // the live state carries the elevation nudge, so this is the vector the tick really emits
      const p = sunroomPress(sunroomStateAt(stopIndex(name)).light);
      assert.ok(Math.abs(p.x - x) <= 0.1 && Math.abs(p.y - y) <= 0.1, `${name}: ${p.x},${p.y} vs ${x},${y}`);
    }
  });
});

describe("pure functions", () => {
  it("sunroomShadows: pane is bevel-free twin with a 0.3 crease; float is the twin at 1.5x", () => {
    const l = SUNROOM_STOPS[2].light; // morning 7/7/14
    const s = sunroomShadows(l);
    assert.match(s.pane, /^0px 0px 0px 1px rgba\(163,177,198,0\.17\), 7px 7px 14px rgba\(163,177,198,0\.55\), -7px -7px 14px rgba\(255,255,255,0\.85\)$/);
    assert.match(s.float, /10\.5px 10\.5px 21px/);
    assert.match(s.contact, /^0\.7px 0\.7px 2px rgba\(163,177,198,0\.25\)$/);
  });
  it("sunroomPress: 2px along the unit light vector, no NaN at zero", () => {
    assert.deepEqual(sunroomPress({ ...SUNROOM_STOPS[3].light }), { x: 0, y: 2 });
    assert.deepEqual(sunroomPress({ ...SUNROOM_STOPS[3].light, lightX: 0, lightY: 0 }), { x: 0, y: 0 });
  });
  it("shouldStopFade: only a real light/dark flip, never first emission or reduced motion", () => {
    assert.equal(shouldStopFade(null, true, false), false);
    assert.equal(shouldStopFade(false, true, false), true);
    assert.equal(shouldStopFade(true, false, false), true);
    assert.equal(shouldStopFade(true, true, false), false);
    assert.equal(shouldStopFade(false, true, true), false);
    // the previous emission was a placeholder sun (?wx= preview before the first fetch lands): not a settled stop
    assert.equal(shouldStopFade(false, true, false, false), false);
    assert.equal(shouldStopFade(false, true, false, true), true);
  });
});

describe("N2 ink ramp on panel", () => {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (h: string) => 0.2126 * lin(parseInt(h.slice(1, 3), 16)) + 0.7152 * lin(parseInt(h.slice(3, 5), 16)) + 0.0722 * lin(parseInt(h.slice(5, 7), 16));
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  it("ink > ink-dim > ink-faint at every stop, step and t sample", () => {
    const ts: number[] = [];
    for (let i = 0; i < 6; i++) for (let s = 0; s <= 19; s++) ts.push(i + s / 20);
    for (let s = 0; s < 48; s++) ts.push((s / 48) * 6);
    for (const t of ts) {
      const { palette: p } = sunroomStateAt(t);
      const [a, b, c] = [p.ink, p.inkDim, p.inkFaint].map((x) => ratio(x, p.panel));
      assert.ok(a > b && b > c, `t=${t}: ${a.toFixed(2)} ${b.toFixed(2)} ${c.toFixed(2)}`);
    }
  });
});

const generated = () => JSON.parse(execFileSync(process.execPath, ["scripts/gen-sunroom-css.mjs", "--json"], { cwd: process.cwd(), maxBuffer: 1 << 24 }).toString()) as { css: string; names: string[] };

describe("N6 / N7 generated tokens", () => {
  const gen = generated();
  const tick = new Set(Object.keys(sunroomCssVars(sunroomStateAt(2), sunroomStateAt(2).light)));
  const declared = new Set([...gen.css.matchAll(/(--sr-[\w-]+)\s*:/g)].map((m) => m[1]));
  it("N7: regenerated tokens.css equals the committed file", () => {
    assert.equal(gen.css, read("tokens.css").replace(/\r\n/g, "\n")); // a Windows checkout (autocrlf) has CRLF; the generator writes LF
  });
  it("N6: every tokens.json name is emitted by tokens.css or the tick", () => {
    const missing = gen.names.filter((n) => !declared.has(n) && !tick.has(n));
    assert.deepEqual(missing, []);
  });
  it("N6: every var(--sr-*) in kiosk/sunroom/*.css resolves", () => {
    const own = new Set<string>();
    for (const f of cssFiles()) for (const m of read(f).matchAll(/(--sr-[\w-]+)\s*:/g)) own.add(m[1]);
    const unresolved: string[] = [];
    for (const f of cssFiles()) for (const m of read(f).matchAll(/var\((--sr-[\w-]+)/g)) {
      if (!declared.has(m[1]) && !tick.has(m[1]) && !own.has(m[1])) unresolved.push(`${f}: ${m[1]}`);
    }
    assert.deepEqual(unresolved, []);
  });
});

// ---- a small CSS block parser shared by N8 and N10 (ported from SR/checks.mjs:313-384) ----
interface Rule { sel: string; body: string; media: string }
function parseCss(text: string) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const kfs: { name: string; body: string }[] = [];
  const walk = (src: string, media: string) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) break;
      const sel = src.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (depth && j < src.length) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; }
      const body = src.slice(open + 1, j - 1);
      if (sel.startsWith("@keyframes")) kfs.push({ name: sel.split(/\s+/)[1], body });
      else if (sel.startsWith("@media") || sel.startsWith("@supports")) walk(body, sel);
      else rules.push({ sel, body, media });
      i = j;
    }
  };
  walk(css, "");
  return { rules, kfs };
}
const OK_PROPS = new Set(["transform", "opacity", "translate", "scale", "rotate"]);
function motionFailures(text: string, label: string): string[] {
  const out: string[] = [];
  const { rules, kfs } = parseCss(text);
  const animated: string[] = [];
  for (const r of rules) for (const d of r.body.split(";")) {
    const [p, ...rest] = d.split(":");
    const prop = (p || "").trim(), val = rest.join(":").trim();
    if (prop === "transition" || prop === "transition-property") {
      if (val === "none" || /^0s?$/.test(val)) continue;
      for (const part of val.split(/,(?![^(]*\))/)) {
        const first = part.trim().split(/\s+/)[0];
        if (!OK_PROPS.has(first)) out.push(`${label}${r.sel}: transitions "${first}"`);
      }
      if (!/reduced-motion/.test(r.media)) animated.push(r.sel);
    }
    if ((prop === "animation" || prop === "animation-name") && val !== "none" && !/reduced-motion/.test(r.media)) animated.push(r.sel);
  }
  for (const k of kfs) for (const m of k.body.matchAll(/([a-z-]+)\s*:/g)) if (!OK_PROPS.has(m[1])) out.push(`${label}@keyframes ${k.name} animates ${m[1]}`);
  const reduced = rules.filter((r) => /prefers-reduced-motion:\s*reduce/.test(r.media)).flatMap((r) => r.sel.split(",").map((s) => s.trim()));
  for (const sel of animated) for (const s of sel.split(",").map((x) => x.trim())) if (!reduced.includes(s)) out.push(`${label}no reduced-motion rule for ${s}`);
  return out;
}

describe("N8 motion scan and N10 scope", () => {
  it("N8: only transform/opacity/translate/scale/rotate move; every animated selector has a reduced-motion rule", () => {
    const fails = cssFiles().flatMap((f) => motionFailures(read(f), `${f}: `));
    assert.deepEqual(fails, []);
  });
  it("N8: no @property --sr-* registration anywhere in the app CSS", () => {
    const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    assert.equal(/@property\s+--sr-/.test(globals), false);
    for (const f of cssFiles()) assert.equal(/@property\s+--sr-/.test(read(f)), false, f);
  });
  it("N8 self-check: the scan catches a colour transition and a missing reduced-motion rule", () => {
    assert.equal(motionFailures(".a { transition: background-color 1s; }", "").length >= 2, true);
    assert.deepEqual(motionFailures(`.a { transition: opacity 1s; } @media (prefers-reduced-motion: reduce) { .a { transition: none; } }`, ""), []);
  });
  it("N10: every selector in kiosk/sunroom/*.css starts with the Sunroom scope", () => {
    const bad: string[] = [];
    for (const f of cssFiles()) for (const r of parseCss(read(f)).rules) {
      for (const s of r.sel.split(/,(?![^(]*\))/).map((x) => x.trim())) if (!s.startsWith(SCOPE)) bad.push(`${f}: ${s}`);
    }
    assert.deepEqual(bad, []);
  });
});

describe("N9 odometer", () => {
  it("30 steps each way stay in cells 5-14 and move one cell per change", () => {
    for (const dirs of [1, -1] as const) {
      let rest = foldReelIndex(9), digit = 9, bad = 0;
      for (let n = 0; n < 30; n++) {
        const nd = (digit + dirs + 10) % 10;
        const target = nextReelIndex(rest, nd, dirs);
        if (target - rest !== dirs || target % 10 !== nd) bad++;
        rest = foldReelIndex(target);
        digit = nd;
        assert.ok(rest >= 5 && rest <= 14, `rest ${rest}`);
      }
      assert.equal(bad, 0);
    }
  });
});

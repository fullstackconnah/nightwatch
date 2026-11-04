#!/usr/bin/env node
/* Contrast gate for the sunroom solar ramp (src/lib/sunroom-light.ts).
 *
 * Enforces gates 1 and 2 of docs/kiosk-analysis/sunroom-01-living-light.md:
 *
 *   Gate 1 — every foreground token clears WCAG AA 4.5:1 against bg, panel
 *            and panel-2 at all six named stops.
 *   Gate 2 — and at every sampled point BETWEEN adjacent stops, including the
 *            5→0 wrap through the small hours.
 *
 * Gate 2 is the one that earns its keep. Linear RGB interpolation between two
 * colours that both pass can dip below the line partway across, because
 * relative luminance is not linear in sRGB channels — so a ramp built only
 * from spot-checked keyframes can ship a theme that is legible at 9am and at
 * noon and illegible at 10:30. Nothing here samples only the stops.
 *
 * The ramp is TypeScript and this is a plain script, so it is compiled with
 * the repo's own tsc into a temp dir and imported from there. That is
 * deliberately not a duplicated copy of the stop table: a second copy is a
 * second thing to forget to update, and the whole point of this file is to be
 * the thing that cannot silently disagree with what ships. (Node here is
 * v22.15, which does support `--experimental-strip-types` — a real check
 * with `node --version` confirmed that, unlike an earlier draft of this
 * comment, which compared "22.15" to "22.6" as strings rather than numbers
 * and concluded the flag was unavailable. The tsc route was kept anyway: it
 * runs the project's actual compiler rather than a still-experimental type
 * stripper, so a real type error here fails loudly instead of silently
 * passing through, and it produces no ExperimentalWarning noise in front of
 * the gate's own PASS/FAIL output.)
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRamp } from "./sunroom-ramp.mjs";

const AA = 4.5;
/** Samples strictly between each adjacent stop pair. 19 gives a reading every
 *  5% of the way across, which is well below the width of any dip a linear
 *  blend of two near-neighbour colours can produce. */
const STEPS_BETWEEN = 19;

const FOREGROUNDS = ["ink", "inkDim", "inkFaint", "accent", "accentDim", "ok", "warn", "bad"];
const SURFACES = ["bg", "panel", "panel2"];

function channelLuminance(c8) {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const h = hex.replace("#", "");
  const r = channelLuminance(parseInt(h.slice(0, 2), 16));
  const g = channelLuminance(parseInt(h.slice(2, 4), 16));
  const b = channelLuminance(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every foreground x surface pair for one palette, worst first. */
function auditPalette(palette) {
  const rows = [];
  for (const fg of FOREGROUNDS) {
    for (const surface of SURFACES) {
      rows.push({ fg, surface, ratio: contrast(palette[fg], palette[surface]) });
    }
  }
  return rows.sort((x, y) => x.ratio - y.ratio);
}

/* The ramp is compiled and imported by scripts/sunroom-ramp.mjs (shared with gen-sunroom-css.mjs): one compile path,
 * no second copy of the stop table. */
let ramp;
try {
  ramp = await loadRamp();
} catch (err) {
  console.error("Failed to compile src/lib/sunroom-light.ts:\n");
  console.error(err.stdout?.toString() || err.message);
  process.exit(1);
}

const { SUNROOM_STOPS, sunroomStateAt, sunroomT, sunroomShadows } = ramp.mod;

const failures = [];

console.log("\nGATE 1 — the six named stops\n");
console.log("  stop      worst pair                     ratio");
console.log("  --------  -----------------------------  -----");
for (const stop of SUNROOM_STOPS) {
  const rows = auditPalette(stop.palette);
  const worst = rows[0];
  const bad = rows.filter((r) => r.ratio < AA);
  const mark = bad.length ? "FAIL" : "ok";
  console.log(
    `  ${stop.name.padEnd(8)}  ${`${worst.fg} on ${worst.surface}`.padEnd(29)}  ${worst.ratio.toFixed(2)}  ${mark}`,
  );
  for (const r of bad) {
    failures.push(`stop ${stop.name}: ${r.fg} on ${r.surface} = ${r.ratio.toFixed(2)} (need ${AA})`);
  }
}

console.log(`\nGATE 2 — ${STEPS_BETWEEN} samples between every adjacent pair, including the 5→0 wrap\n`);
console.log("  span               worst pair                     ratio");
console.log("  -----------------  -----------------------------  -----");
for (let i = 0; i < SUNROOM_STOPS.length; i++) {
  const from = SUNROOM_STOPS[i];
  const to = SUNROOM_STOPS[(i + 1) % SUNROOM_STOPS.length];
  let spanWorst = null;
  let exempt = 0;
  for (let s = 1; s <= STEPS_BETWEEN; s++) {
    const k = s / (STEPS_BETWEEN + 1);
    const state = sunroomStateAt(i + k);
    /* THE ONE EXEMPTION IN THIS FILE, and it is deliberate rather than
       convenient. Between a light stop and the dark one there is a band of
       ground luminance where no ink colour clears 4.5:1 — dark ink needs the
       ground above ~0.33, light ink needs it below ~0.18, and nothing lives
       between. No palette choice fixes that; it is arithmetic. The design's
       answer is to cross the band in a few hundred milliseconds instead of
       ninety seconds (see `crossing` in sunroom-light.ts and the transition
       the component emits for it), so what this gate must enforce is that
       BOTH ENDS are legible and that the transit is genuinely brief — not
       that an impossible midpoint passes. Asserting AA here would only be
       satisfiable by never going dark at all. Exempted samples are counted
       and printed so this can never quietly grow. */
    if (state.crossing) { exempt++; continue; }
    const rows = auditPalette(state.palette);
    if (!spanWorst || rows[0].ratio < spanWorst.ratio) spanWorst = { ...rows[0], k };
    for (const r of rows.filter((r) => r.ratio < AA)) {
      failures.push(
        `between ${from.name}→${to.name} at ${(k * 100).toFixed(0)}%: ${r.fg} on ${r.surface} = ${r.ratio.toFixed(2)}`,
      );
    }
  }
  const note = exempt ? `${exempt}/${STEPS_BETWEEN} exempt (light↔dark transit)` : "";
  if (!spanWorst) {
    console.log(`  ${`${from.name}→${to.name}`.padEnd(17)}  ${"— entirely in transit —".padEnd(29)}  ····  ${note}`);
  } else {
    const mark = spanWorst.ratio < AA ? "FAIL" : "ok";
    console.log(
      `  ${`${from.name}→${to.name}`.padEnd(17)}  ${`${spanWorst.fg} on ${spanWorst.surface}`.padEnd(29)}  ${spanWorst.ratio.toFixed(2)}  ${mark}  ${note}`,
    );
  }
}

/* GATE 3 — the weather cube.
 *
 * Cloud greys the ground and rain darkens it, which means both move the exact
 * quantity every contrast ratio is measured against. A ramp verified only
 * along the solar axis is verified for clear weather and nothing else — and
 * the heaviest rain is precisely when someone is most likely to be squinting
 * at this thing from across a room. So the whole t x cloud x rain cube gets
 * swept, not the three axes independently. */
console.log("\nGATE 3 — t x cloud x rain\n");
console.log("  cloud  rain   worst pair                     ratio");
console.log("  -----  -----  -----------------------------  -----");
const T_SAMPLES = 48;
let cubeChecked = 0;
let cubeExempt = 0;
for (const cloud01 of [0, 0.35, 0.7, 1]) {
  for (const rain01 of [0, 0.5, 1]) {
    let worst = null;
    for (let s = 0; s < T_SAMPLES; s++) {
      const t = (s / T_SAMPLES) * SUNROOM_STOPS.length;
      const state = sunroomStateAt(t, { cloud01, rain01 });
      if (state.crossing) { cubeExempt++; continue; }
      cubeChecked++;
      const rows = auditPalette(state.palette);
      if (!worst || rows[0].ratio < worst.ratio) worst = { ...rows[0], t };
      for (const r of rows.filter((r) => r.ratio < AA)) {
        failures.push(
          `cloud=${cloud01} rain=${rain01} t=${t.toFixed(2)}: ${r.fg} on ${r.surface} = ${r.ratio.toFixed(2)}`,
        );
      }
    }
    const mark = !worst ? "····" : worst.ratio < AA ? "FAIL" : "ok";
    console.log(
      `  ${String(cloud01).padEnd(5)}  ${String(rain01).padEnd(5)}  ${(worst ? `${worst.fg} on ${worst.surface}` : "—").padEnd(29)}  ${worst ? worst.ratio.toFixed(2) : "—"}  ${mark}`,
    );
  }
}
console.log(`\n  ${cubeChecked} samples checked, ${cubeExempt} exempt as light↔dark transit`);

/* GATE 4 — rain marks over the wet grounds.
 *
 * The puddle-line rain keeps its loud marks (rings, crowns) out of the glance
 * text zones by a mask, so what can reach text there is one streak at its
 * zone floor, plus the storm flash at peak. Darkening marks go in at their
 * maximum; the white day rings, the day sheen and the day flash only lighten,
 * and the dark sheen is masked to 0, so they are left out (a lightening can
 * only raise dark-ink contrast). Both inks are checked: inkDim is the stricter.
 * The numbers come from the shipped kiosk-weather-fx.ts, read in a child node
 * with type stripping so this file never holds a second copy. */
console.log("\nGATE 4 — rain marks over the wet grounds\n");
const fx = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--input-type=module",
      "-e",
      `import * as f from "./src/lib/kiosk-weather-fx.ts";
const out = { flash: f.FLASH_PEAK_ALPHA, glow: f.FLASH_GLOW_HEX, bands: {} };
for (const [name, band, storm] of [["drizzle","drizzle",false],["light","light",false],["moderate","moderate",false],["heavy","heavy",false],["storm","heavy",true]]) {
  const r = f.rainParams(band, 0, 1280, 800);
  out.bands[name] = { alpha: r.alphaNear, floor: { day: f.puddleParams(band, storm, false, 1280, 800).streakFloor, dark: f.puddleParams(band, storm, true, 1280, 800).streakFloor }, storm,
    still: Object.fromEntries([["day", false], ["dark", true]].map(([m, d]) => { const q = f.puddleParams(band, storm, d, 1280, 800); return [m, [q.stillSheenAlpha, q.stillSheenFloor]]; })) };
}
console.log(JSON.stringify(out));`,
    ],
    { cwd: process.cwd() },
  ).toString(),
);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lumRgb = (c) => 0.2126 * channelLuminance(c[0]) + 0.7152 * channelLuminance(c[1]) + 0.0722 * channelLuminance(c[2]);
const blend = (g, c, a) => g.map((v, i) => v * (1 - a) + c[i] * a);
const contrastRgb = (a, b) => {
  const [hi, lo] = [lumRgb(a), lumRgb(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const glowRgb = hexRgb(fx.glow);
const dayStreak = hexRgb("#283448");
let rainChecked = 0;
let rainWorst = null;
let maxFlashStep = 0;
for (let i = 0; i < SUNROOM_STOPS.length; i++) {
  for (const k of [0, 0.5]) {
    const st = sunroomStateAt(i + k, { cloud01: 1, rain01: 1 });
    if (st.crossing) continue;
    const mode = st.isDark ? "dark" : "light";
    const bg = hexRgb(st.palette.bg);
    maxFlashStep = Math.max(maxFlashStep, Math.abs(lumRgb(blend(bg, glowRgb, fx.flash[mode])) - lumRgb(bg)));
    for (const ink of ["ink", "inkDim"]) {
      const base = contrastRgb(hexRgb(st.palette[ink]), bg);
      if (base < AA) continue; // only layers we add may fail
      for (const [name, b] of Object.entries(fx.bands)) {
        let px = bg;
        if (b.storm && st.isDark) px = blend(px, glowRgb, fx.flash.dark);
        px = blend(px, st.isDark ? glowRgb : dayStreak, b.alpha[mode] * (st.isDark ? b.floor.dark : b.floor.day));
        const c = contrastRgb(hexRgb(st.palette[ink]), px);
        rainChecked++;
        if (!rainWorst || c < rainWorst.c) rainWorst = { c, label: `${SUNROOM_STOPS[i].name}+${k} ${ink} ${name}` };
        if (c < AA) failures.push(`rain marks: ${SUNROOM_STOPS[i].name}+${k} wet ${ink} ${name} = ${c.toFixed(2)}`);
      }
    }
  }
}
console.log(`  ${rainChecked} cells checked, worst ${rainWorst.c.toFixed(2)} (${rainWorst.label}); largest flash step ${maxFlashStep.toFixed(3)}`);
if (maxFlashStep > 0.05) failures.push(`flash luminance step ${maxFlashStep.toFixed(3)} is over 0.05`);

/* Reduced motion: the still frame is the sheen alone (no streak, no flash, no rings). By day it is a slate
 * darkening, unmasked (floor 1), so it is counted here; at dusk and night it is the dark sheen at floor 0. */
let stillChecked = 0;
let stillWorst = null;
for (let i = 0; i < SUNROOM_STOPS.length; i++) {
  for (const k of [0, 0.5]) {
    const st = sunroomStateAt(i + k, { cloud01: 1, rain01: 1 });
    if (st.crossing) continue;
    const mode = st.isDark ? "dark" : "day";
    const bg = hexRgb(st.palette.bg);
    for (const ink of ["ink", "inkDim"]) {
      if (contrastRgb(hexRgb(st.palette[ink]), bg) < AA) continue;
      for (const [name, b] of Object.entries(fx.bands)) {
        const [a, fl] = b.still[mode];
        const px = blend(bg, st.isDark ? glowRgb : dayStreak, a * fl);
        const c = contrastRgb(hexRgb(st.palette[ink]), px);
        stillChecked++;
        if (!stillWorst || c < stillWorst.c) stillWorst = { c, label: `${SUNROOM_STOPS[i].name}+${k} ${ink} ${name}` };
        if (c < AA) failures.push(`rain still: ${SUNROOM_STOPS[i].name}+${k} wet ${ink} ${name} = ${c.toFixed(2)}`);
      }
    }
  }
}
console.log(`  ${stillChecked} still cells checked, worst ${stillWorst.c.toFixed(2)} (${stillWorst.label})`);
if (stillChecked < 6 * 2 * 5) failures.push(`rain still pass is vacuous: ${stillChecked} cells`);

/* Not a contrast gate, but a cheap guard on the thing the whole design rests
 * on: if the shadow's horizontal offset does not actually change sign across
 * the day, the light is not travelling and this is just a recoloured static
 * theme. Cheaper to catch here than in a browser. */
console.log("\nLIGHT TRAVEL — shadow x-offset across the day\n");
const travel = [
  ["deep night", { elevationDeg: -40, hourAngleDeg: -150 }],
  ["dawn", { elevationDeg: 0, hourAngleDeg: -85 }],
  ["mid-morning", { elevationDeg: 22, hourAngleDeg: -45 }],
  ["solar noon", { elevationDeg: 48, hourAngleDeg: -1 }],
  ["afternoon", { elevationDeg: 22, hourAngleDeg: 45 }],
  ["golden", { elevationDeg: 9, hourAngleDeg: 75 }],
  ["dusk", { elevationDeg: 0, hourAngleDeg: 88 }],
];
const offsets = {};
for (const [label, sun] of travel) {
  const t = sunroomT(sun);
  const { light } = sunroomStateAt(t);
  offsets[label] = light.lightX;
  console.log(
    `  ${label.padEnd(12)} t=${t.toFixed(2)}  shadowX=${light.lightX.toFixed(1).padStart(6)}px  ` +
      `blur=${light.blur.toFixed(0).padStart(2)}px  warmth=${light.warmth.toFixed(2)}`,
  );
}
if (!(offsets["mid-morning"] > 0 && offsets["afternoon"] < 0)) {
  failures.push(
    `light does not travel: mid-morning shadowX=${offsets["mid-morning"].toFixed(1)}, ` +
      `afternoon shadowX=${offsets["afternoon"].toFixed(1)} — expected positive then negative`,
  );
}
if (Math.abs(offsets["solar noon"]) > 2.5) {
  failures.push(`solar noon shadowX=${offsets["solar noon"].toFixed(1)} — expected near zero (overhead light)`);
}

/* GATE 5 — the Sill design-system pairs (shape brief checks N1 to N4).
 *
 * src/lib/sunroom-tokens.json is the DS contract. Each colour token's usage note names the grounds it must
 * read on ("Reads on `bg`, `panel` ..." / "Holds 3:1 on ..."; "`a` over `b`" composites a over b), and its
 * prefix sets the floor: Text 4.5, Figure and Mark 3. They are swept at the six stops, the between-stop
 * steps and 48 t samples, light and dark crossing exempt as in gate 2 (ported from SR/checks.mjs:70-168).
 * Also: N2 the ink ramp steps down on panel, N3 the on face differs from the off face and `handle` holds 3:1,
 * N4 the pane edge and crease clear the per-stop floor (SR/checks.mjs:170-209, Gaussian model). */
console.log("\nGATE 5 — DS pairs, ink ramp, on/off, pane edge\n");
const tokensJson = JSON.parse(readFileSync(join(process.cwd(), "src/lib/sunroom-tokens.json"), "utf8"));
const camel = (n) => n.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const tokByName = Object.fromEntries(tokensJson.color.tokens.map((t) => [t.name, t]));
const hexRgba = (h) => {
  let s = h.slice(1);
  if (s.length <= 4) s = [...s].map((c) => c + c).join("");
  const n = (i) => parseInt(s.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? n(6) / 255 : 1 };
};
const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
const linC = (c) => channelLuminance(c);
const lumC = (c) => 0.2126 * linC(c.r) + 0.7152 * linC(c.g) + 0.0722 * linC(c.b);
const ratioC = (a, b) => { const x = lumC(a), y = lumC(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const paletteColor = (palette, name) => {
  let t = tokByName[name];
  while (t && typeof t.value === "string") t = tokByName[t.value.slice(1, -1)]; // alias chain (stale, meter)
  const key = camel(t ? t.name : name);
  const v = palette[key];
  if (v === undefined) throw new Error(`palette has no "${key}" for token ${name}`);
  return hexRgba(v);
};
const NEED = { "Text:": 4.5, "Figure:": 3, "Mark:": 3 };
const pairTokens = tokensJson.color.tokens
  .map((t) => ({ t, need: NEED[Object.keys(NEED).find((k) => t.usage.startsWith(k))] }))
  .filter((x) => x.need);
const groundsOf = (usage) => {
  const m = /(Reads on|Holds 3:1 on) ([^.]*)\./.exec(usage);
  if (!m) return [];
  const out = [];
  const re = /`([^`]+)`( over `([^`]+)`)?/g;
  let g;
  while ((g = re.exec(m[2]))) out.push({ top: g[1], under: g[3] || null });
  return out;
};
const pairs = pairTokens.map((x) => ({ ...x, grounds: groundsOf(x.t.usage) }));
for (const p of pairs) if (!p.grounds.length) failures.push(`DS token ${p.t.name}: its usage note names no ground`);
const groundColor = (palette, g) => {
  const top = paletteColor(palette, g.top);
  return g.under ? over(top, paletteColor(palette, g.under)) : top;
};
function auditDs(palette) {
  const rows = [];
  for (const p of pairs) {
    const fg = paletteColor(palette, p.t.name);
    for (const g of p.grounds) {
      rows.push({ token: p.t.name, ground: g.under ? `${g.top}/${g.under}` : g.top, need: p.need, ratio: ratioC(fg, groundColor(palette, g)) });
    }
  }
  return rows;
}
let dsChecked = 0;
let dsWorst = null;
const dsSample = (state, label) => {
  for (const r of auditDs(state.palette)) {
    dsChecked++;
    const slack = r.ratio / r.need;
    if (!dsWorst || slack < dsWorst.slack) dsWorst = { ...r, slack, label };
    if (r.ratio < r.need) failures.push(`DS ${label}: ${r.token} on ${r.ground} = ${r.ratio.toFixed(2)} (need ${r.need})`);
  }
};
let dsExempt = 0;
for (let i = 0; i < SUNROOM_STOPS.length; i++) dsSample(sunroomStateAt(i, { elev01: 0.5 }), `stop ${SUNROOM_STOPS[i].name}`);
for (let i = 0; i < SUNROOM_STOPS.length; i++) {
  for (let s = 1; s <= STEPS_BETWEEN; s++) {
    const state = sunroomStateAt(i + s / (STEPS_BETWEEN + 1), { elev01: 0.5 });
    if (state.crossing) { dsExempt++; continue; }
    dsSample(state, `${SUNROOM_STOPS[i].name}+${(s / (STEPS_BETWEEN + 1)).toFixed(2)}`);
  }
}
for (let s = 0; s < 48; s++) {
  const state = sunroomStateAt((s / 48) * SUNROOM_STOPS.length, { elev01: 0.5 });
  if (state.crossing) { dsExempt++; continue; }
  dsSample(state, `t${((s / 48) * SUNROOM_STOPS.length).toFixed(2)}`);
}
console.log(`  N1  ${dsChecked} pairs checked (${pairs.length} tokens), ${dsExempt} samples exempt as transit; closest to its floor: ${dsWorst.token} on ${dsWorst.ground} ${dsWorst.ratio.toFixed(2)} vs ${dsWorst.need} at ${dsWorst.label}`);

// N2 ink ramp on panel, N3 handle/on-off, at every stop, step and t sample
let rampChecked = 0;
let onOffMin = Infinity;
const rampSample = (state, label) => {
  const panel = hexRgba(state.palette.panel);
  const [a, b, c] = ["ink", "inkDim", "inkFaint"].map((n) => ratioC(hexRgba(state.palette[n]), panel));
  rampChecked++;
  if (!(a > b && b > c)) failures.push(`N2 ink ramp not ordered at ${label}: ${a.toFixed(2)} / ${b.toFixed(2)} / ${c.toFixed(2)}`);
  if (state.crossing) return; // the ink is in transit: lightness of on/off is read at rest
  const onOff = ratioC(hexRgba(state.palette.sunlit), panel);
  onOffMin = Math.min(onOffMin, onOff);
  if (!(onOff > 1.02)) failures.push(`N3 on face (sunlit) is not distinct from off (panel) at ${label}: ${onOff.toFixed(3)}`);
};
for (let i = 0; i < SUNROOM_STOPS.length; i++) {
  rampSample(sunroomStateAt(i, { elev01: 0.5 }), SUNROOM_STOPS[i].name);
  for (let s = 1; s <= STEPS_BETWEEN; s++) rampSample(sunroomStateAt(i + s / (STEPS_BETWEEN + 1), { elev01: 0.5 }), `${SUNROOM_STOPS[i].name}+${s}`);
}
for (let s = 0; s < 48; s++) rampSample(sunroomStateAt((s / 48) * SUNROOM_STOPS.length, { elev01: 0.5 }), `t${s}`);
console.log(`  N2  ink > ink-dim > ink-faint on panel: ${rampChecked} samples, all ordered`);
console.log(`  N3  on face vs off face lightness ratio, lowest ${onOffMin.toFixed(3)}; handle holds 3:1 on panel (in N1 pairs)`);
if (!pairs.some((p) => p.t.name === "handle" && p.grounds.some((g) => g.top === "panel" && !g.under))) failures.push("N3 `handle` is not checked as a 3:1 mark on `panel`");

// N4 pane edge and crease
const EDGE_FLOOR = { morning: 1.107, dawn: 1.121, midday: 1.132, golden: 1.109, dusk: 1.127, night: 1.080 };
const parseLayers = (s) => s.split(/,(?![^(]*\))/).map((p) => {
  const m = /^(inset )?(-?[\d.]+)(?:px)? (-?[\d.]+)(?:px)? (-?[\d.]+)(?:px)?(?: (-?[\d.]+)(?:px)?)? rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(p.trim());
  if (!m) throw new Error(`cannot parse shadow layer "${p}"`);
  return { inset: !!m[1], x: +m[2], y: +m[3], b: +m[4], s: +(m[5] || 0), c: { r: +m[6], g: +m[7], b: +m[8], a: +m[9] } };
});
const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const cover = (l, n, d) => { const on = l.x * n[0] + l.y * n[1]; const w = l.inset ? l.s - on : l.s + on; return l.b > 0 ? Phi((w - d) / (l.b / 2)) : w > d ? 1 : 0; };
const paintC = (base, ls, n, d) => ls.slice().reverse().reduce((g, l) => over({ ...l.c, a: l.c.a * cover(l, n, d) }, g), base);
for (const stop of SUNROOM_STOPS) {
  const state = sunroomStateAt(SUNROOM_STOPS.indexOf(stop), { elev01: 0.5 });
  const sh = sunroomShadows(state.light);
  const ls = parseLayers(`${sh.bevel}, ${sh.pane}`);
  const inn = ls.filter((l) => l.inset);
  const out = ls.filter((l) => !l.inset);
  const panel = hexRgba(state.palette.panel);
  const bg = hexRgba(state.palette.bg);
  const edge = Math.min(...SIDES.map((n) => ratioC(paintC(panel, inn, n, 0.5), paintC(bg, out, n, 0.5))));
  console.log(`  N4  ${stop.name.padEnd(8)} pane edge ${edge.toFixed(3)} (floor ${EDGE_FLOOR[stop.name]})`);
  if (edge < EDGE_FLOOR[stop.name]) failures.push(`N4 ${stop.name}: pane edge ${edge.toFixed(3)} < ${EDGE_FLOOR[stop.name]}`);
}

ramp.cleanup();

console.log("");
if (failures.length) {
  console.log(`${failures.length} FAILURE(S):\n`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log("");
  process.exit(1);
}
console.log("ALL PASS — every stop and every sampled midpoint clears AA 4.5:1, the DS pairs hold, and the light travels.\n");

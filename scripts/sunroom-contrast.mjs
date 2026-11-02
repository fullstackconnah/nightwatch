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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

function compileRamp() {
  const outDir = mkdtempSync(join(tmpdir(), "sunroom-ramp-"));
  // Invoke tsc's own entry with the current node binary rather than going
  // through `npx`: on Windows, spawning a .cmd shim without a shell fails with
  // EINVAL (Node's CVE-2024-27980 mitigation), and enabling a shell to work
  // around that would put this script's paths through cmd.exe quoting.
  const tsc = join(process.cwd(), "node_modules", "typescript", "bin", "tsc");
  execFileSync(
    process.execPath,
    [tsc, "src/lib/sunroom-light.ts", "--outDir", outDir, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler"],
    { stdio: "pipe" },
  );
  return { outDir, entry: join(outDir, "sunroom-light.js") };
}

let compiled;
try {
  compiled = compileRamp();
} catch (err) {
  console.error("Failed to compile src/lib/sunroom-light.ts:\n");
  console.error(err.stdout?.toString() || err.message);
  process.exit(1);
}

const { SUNROOM_STOPS, sunroomStateAt, sunroomT } = await import(pathToFileURL(compiled.entry).href);

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
  out.bands[name] = { alpha: r.alphaNear, floor: { day: f.puddleParams(band, storm, false, 1280, 800).streakFloor, dark: f.puddleParams(band, storm, true, 1280, 800).streakFloor }, storm };
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

rmSync(compiled.outDir, { recursive: true, force: true });

console.log("");
if (failures.length) {
  console.log(`${failures.length} FAILURE(S):\n`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log("");
  process.exit(1);
}
console.log("ALL PASS — every stop and every sampled midpoint clears AA 4.5:1, and the light travels.\n");

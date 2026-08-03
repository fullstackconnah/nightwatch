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
  for (let s = 1; s <= STEPS_BETWEEN; s++) {
    const k = s / (STEPS_BETWEEN + 1);
    const { palette } = sunroomStateAt(i + k);
    const rows = auditPalette(palette);
    if (!spanWorst || rows[0].ratio < spanWorst.ratio) spanWorst = { ...rows[0], k };
    for (const r of rows.filter((r) => r.ratio < AA)) {
      failures.push(
        `between ${from.name}→${to.name} at ${(k * 100).toFixed(0)}%: ${r.fg} on ${r.surface} = ${r.ratio.toFixed(2)}`,
      );
    }
  }
  const mark = spanWorst.ratio < AA ? "FAIL" : "ok";
  console.log(
    `  ${`${from.name}→${to.name}`.padEnd(17)}  ${`${spanWorst.fg} on ${spanWorst.surface}`.padEnd(29)}  ${spanWorst.ratio.toFixed(2)}  ${mark}`,
  );
}

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

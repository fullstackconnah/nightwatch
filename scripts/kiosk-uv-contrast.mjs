#!/usr/bin/env node
/* N7 (kiosk UV and air): the tone colours the sun-air pane and inline use (`--color-warn`, `--color-bad`) clear WCAG 4.5:1 on the
 * three grounds (`--color-bg`, `--color-panel`, `--color-panel-2`) of every KIOSK_THEMES entry and every sunroom stop. Node only, no browser:
 *
 *   node scripts/kiosk-uv-contrast.mjs        (exits 1 on any pair below 4.5)
 *
 * Themes: the `:root` colours, overridden by that theme's `[data-kiosk-theme="x"]` block in src/app CSS (hex values only; a value that is
 * not a hex, such as a var() or color-mix(), is reported under `unresolved`, not guessed). Sunroom: the six stops in src/lib/sunroom-light.ts,
 * which carries its own warn and bad. kiosk-shots.mjs imports uvContrast() and puts the result in its summary JSON as sunAir.N7. */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIN = 4.5;

function lum(hex) {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const isHex = (v) => typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);

function cssFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith(".css") ? [p] : [];
  });
}

/** `--color-*` declarations of one block whose selector is exactly `sel`, across every CSS file under src/app. */
function blockVars(css, sel) {
  const out = {};
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const m of css.matchAll(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, "g"))) {
    for (const d of m[1].matchAll(/(--color-(?:bg|panel|panel-2|warn|bad|ink|ink-dim|ink-faint))\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}

const camel = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());

/** `tones`: the text colours to check (default the UV pane's warn and bad; the list sheet passes ink, ink-dim and ink-faint). */
export async function uvContrast(tones = ["warn", "bad"]) {
  const css = cssFiles(join(ROOT, "src/app")).map((p) => readFileSync(p, "utf8")).join("\n");
  const themes = [...readFileSync(join(ROOT, "src/components/kiosk/kiosk-theme.tsx"), "utf8").match(/KIOSK_THEMES[^=]*=\s*\[([^\]]*)\]/)[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  const base = { ...blockVars(css, "@theme"), ...blockVars(css, ":root") };
  const rows = [];
  const unresolved = [];
  for (const t of themes.filter((n) => n !== "sunroom")) {
    const v = { ...base, ...blockVars(css, `[data-kiosk-theme="${t}"]`) };
    for (const tone of tones.map((n) => `--color-${n}`)) {
      for (const ground of ["--color-bg", "--color-panel", "--color-panel-2"]) {
        if (!isHex(v[tone]) || !isHex(v[ground])) unresolved.push(`${t} ${tone} on ${ground}`);
        else rows.push({ where: `${t} ${tone.slice(8)} on ${ground.slice(8)}`, ratio: ratio(v[tone], v[ground]) });
      }
    }
  }
  const src = stripTypeScriptTypes(readFileSync(join(ROOT, "src/lib/sunroom-light.ts"), "utf8"));
  const { SUNROOM_STOPS } = await import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
  for (const s of SUNROOM_STOPS) {
    for (const tone of tones) {
      for (const ground of ["bg", "panel", "panel2"]) rows.push({ where: `sunroom ${s.name} ${tone} on ${ground}`, ratio: ratio(s.palette[camel(tone)], s.palette[ground]) });
    }
  }
  const failures = rows.filter((r) => r.ratio < MIN);
  const r2 = (n) => Math.round(n * 100) / 100;
  return { min: MIN, checked: rows.length, lowest: r2(Math.min(...rows.map((r) => r.ratio))), failures: failures.map((f) => ({ ...f, ratio: r2(f.ratio) })), unresolved, pass: rows.length > 0 && failures.length === 0 };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const r = await uvContrast();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.pass ? 0 : 1);
}

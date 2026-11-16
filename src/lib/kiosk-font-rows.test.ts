import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fontRows } from "./kiosk-font-rows.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const f = (id: string, label: string, kind: "sans" | "serif" | "mono") => ({ id, label, kind, cssVar: "" });
const FONTS = [f("b-sans", "Beta", "sans"), f("a-sans", "Alpha", "sans"), f("z-serif", "Zed", "serif"), f("m-mono", "Mono", "mono"), f("c-sans", "Gamma", "sans")];

test("Text: a sans row and a serif row, default first then A to Z", () => {
  const rows = fontRows(FONTS, "sans", "c-sans");
  assert.deepEqual(rows.map((r) => [r.kind, r.options.map((o) => o.id)]), [
    ["sans", ["c-sans", "a-sans", "b-sans"]],
    ["serif", ["z-serif"]],
  ]);
});

test("Text: a serif default leads the serif row only", () => {
  const rows = fontRows(FONTS, "sans", "z-serif");
  assert.deepEqual(rows[0].options.map((o) => o.id), ["a-sans", "b-sans", "c-sans"]);
  assert.equal(rows[1].options[0].id, "z-serif");
});

test("Numerals: one mono row, and an off-kind theme default is unioned in first", () => {
  assert.deepEqual(fontRows(FONTS, "mono", "m-mono").map((r) => r.options.map((o) => o.id)), [["m-mono"]]);
  const rows = fontRows(FONTS, "mono", "z-serif");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].options.map((o) => o.id), ["z-serif", "m-mono"]);
});

test("every KioskFontId has a KIOSK_FONTS entry, and every --font-t-* it names is loaded", () => {
  const fonts = read("./kiosk-fonts.ts");
  const theme = read("../components/kiosk/kiosk-theme.tsx");
  const union = fonts.slice(fonts.indexOf("export type KioskFontId"), fonts.indexOf("export interface"));
  const ids = [...union.matchAll(/\| "([a-z-]+)"/g)].map((m) => m[1]);
  const entries = [...fonts.matchAll(/\{ id: "([a-z-]+)", label: "[^"]+", kind: "\w+", cssVar: (.+) \},/g)];
  assert.deepEqual(entries.map((m) => m[1]).sort(), [...ids].sort());
  const loaded = new Set([...theme.matchAll(/variable: "(--font-t-[a-z-]+)"/g)].map((m) => m[1]));
  for (const [, id, cssVar] of entries) {
    const used = cssVar.match(/var\((--font-t-[a-z-]+)\)/)?.[1];
    if (used) assert.ok(loaded.has(used), `${id} names ${used}, which kiosk-theme.tsx does not load`);
  }
  const consts = [...theme.matchAll(/^const (f[A-Za-z]+) = [A-Za-z_]+\(\{/gm)].map((m) => m[1]);
  const list = theme.slice(theme.indexOf("const FONT_VARIABLE_CLASSES = ["), theme.indexOf("].map((f) => f.variable)"));
  for (const c of consts) assert.match(list, new RegExp(`\\b${c}\\b`), `${c} is loaded but missing from FONT_VARIABLE_CLASSES`);
  for (const id of ["atkinson-next", "nunito", "geist", "atkinson-mono", "geist-mono", "roboto-mono"]) assert.ok(ids.includes(id), id);
  assert.ok(loaded.size <= 33, `${loaded.size} families loaded; the ceiling is 33`);
});

test("an unknown stored font id is dropped on read, so the slot falls back to the theme default", () => {
  const src = read("./kiosk-fonts.ts");
  assert.match(src, /isKioskFontId\(/);
  assert.match(src, /KIOSK_FONT_IDS\.has\(v as KioskFontId\)/);
});

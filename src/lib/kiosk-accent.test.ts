/* Kiosk accent choice: storage rules, the contrast of every swatch half on every
   fixed theme ground, and the Sunroom ramp's half swap (no browser needed). */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KIOSK_ACCENTS, KIOSK_THEME_GROUND, kioskAccentSwatch, readKioskAccents, setKioskThemeAccent } from "./kiosk-accent.ts";
import { SUNROOM_STOPS, sunroomCssVars, sunroomStateAt } from "./sunroom-light.ts";

/* ---- storage -------------------------------------------------------------- */

type FakeStore = { data: Map<string, string>; throwGet: boolean; throwSet: boolean };
const store: FakeStore = { data: new Map(), throwGet: false, throwSet: false };
let broadcasts = 0;
(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem(k: string) {
      if (store.throwGet) throw new Error("blocked");
      return store.data.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (store.throwSet) throw new Error("blocked");
      store.data.set(k, v);
    },
  },
  dispatchEvent() {
    broadcasts++;
    return true;
  },
};
const KEY = "kiosk-accent";

beforeEach(() => {
  store.data.clear();
  store.throwGet = false;
  store.throwSet = false;
  broadcasts = 0;
});

describe("kiosk accent storage", () => {
  it("picking a swatch saves {...existing, [theme]: id} and broadcasts", () => {
    store.data.set(KEY, JSON.stringify({ aurora: "fern" }));
    setKioskThemeAccent("folio", "orchid");
    assert.deepEqual(JSON.parse(store.data.get(KEY)!), { aurora: "fern", folio: "orchid" });
    assert.equal(broadcasts, 1);
  });
  it("picking Theme default deletes that theme's key", () => {
    store.data.set(KEY, JSON.stringify({ aurora: "fern", folio: "orchid" }));
    setKioskThemeAccent("folio", null);
    assert.deepEqual(JSON.parse(store.data.get(KEY)!), { aurora: "fern" });
    assert.equal(broadcasts, 1);
  });
  it("an unknown swatch id is dropped on read", () => {
    store.data.set(KEY, JSON.stringify({ folio: "magenta", aurora: "fern" }));
    assert.deepEqual(readKioskAccents(), { aurora: "fern" });
  });
  it("an unknown theme key is dropped on read", () => {
    store.data.set(KEY, JSON.stringify({ nope: "fern", toString: "fern", folio: "clay" }));
    assert.deepEqual(readKioskAccents(), { folio: "clay" });
  });
  it("a value that is not a string is dropped", () => {
    store.data.set(KEY, JSON.stringify({ folio: 3, aurora: { id: "fern" }, slate: ["fern"], neon: null }));
    assert.deepEqual(readKioskAccents(), {});
  });
  it("JSON that is not a plain object reads as {}", () => {
    for (const raw of ["[\"fern\"]", "null", "42", "\"fern\"", "true"]) {
      store.data.set(KEY, raw);
      assert.deepEqual(readKioskAccents(), {}, raw);
    }
  });
  it("a missing key or corrupt JSON reads as {}", () => {
    assert.deepEqual(readKioskAccents(), {});
    store.data.set(KEY, "{not json");
    assert.deepEqual(readKioskAccents(), {});
  });
  it("storage that throws on get reads {} and on set still broadcasts", () => {
    store.throwGet = true;
    assert.deepEqual(readKioskAccents(), {});
    store.throwSet = true;
    setKioskThemeAccent("folio", "iris");
    assert.equal(broadcasts, 1);
    assert.equal(store.data.size, 0);
  });
  it("never touches the fonts key", () => {
    store.data.set("kiosk-fonts", "{\"folio\":{\"sans\":\"journal\"}}");
    setKioskThemeAccent("folio", "iris");
    assert.equal(store.data.get("kiosk-fonts"), "{\"folio\":{\"sans\":\"journal\"}}");
  });
});

/* ---- contrast on the fixed themes ----------------------------------------- */

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");
type Rgba = [number, number, number, number];

function parseColor(v: string): Rgba {
  let h = v.trim().slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}
const over = (top: Rgba, under: Rgba): Rgba => [
  top[0] * top[3] + under[0] * (1 - top[3]),
  top[1] * top[3] + under[1] * (1 - top[3]),
  top[2] * top[3] + under[2] * (1 - top[3]),
  1,
];
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (c: Rgba) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: Rgba, b: Rgba) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

function grounds(block: string) {
  const get = (name: string) => {
    const m = new RegExp(`--color-${name}: (#[0-9a-fA-F]+);`).exec(block);
    assert.ok(m, `block has no --color-${name}`);
    return parseColor(m[1]);
  };
  const bg = get("bg");
  return { bg, panel: over(get("panel"), bg), panel2: over(get("panel-2"), bg), light: /color-scheme: light/.test(block) };
}

/** The `default` theme lives in @theme; every other fixed theme in its own [data-kiosk-theme] block. */
const THEME_BLOCKS: Record<string, string> = {};
for (const m of css.matchAll(/^\[data-kiosk-theme="(\w+)"\] \{\n([\s\S]*?)^\}/gm)) {
  if (m[1] !== "sunroom" && !(m[1] in THEME_BLOCKS)) THEME_BLOCKS[m[1]] = m[2];
}
THEME_BLOCKS.default = /^@theme \{\n([\s\S]*?)^\}/m.exec(css)![1];

describe("accent swatch contrast on every fixed theme ground", () => {
  it("covers all 15 non-Sunroom themes", () => {
    assert.equal(Object.keys(THEME_BLOCKS).length, 15);
    assert.deepEqual(Object.keys(THEME_BLOCKS).sort(), Object.keys(KIOSK_THEME_GROUND).filter((t) => t !== "sunroom").sort());
  });
  it("KIOSK_THEME_GROUND agrees with each block's color-scheme", () => {
    for (const [theme, block] of Object.entries(THEME_BLOCKS)) {
      assert.equal(KIOSK_THEME_GROUND[theme as keyof typeof KIOSK_THEME_GROUND], grounds(block).light ? "light" : "dark", theme);
    }
  });
  for (const [theme, block] of Object.entries(THEME_BLOCKS)) {
    it(`${theme}: every swatch half clears its floors`, () => {
      const g = grounds(block);
      const half = KIOSK_THEME_GROUND[theme as keyof typeof KIOSK_THEME_GROUND] as "light" | "dark";
      for (const s of KIOSK_ACCENTS) {
        const accent = parseColor(s[half].accent);
        const dim = parseColor(s[half].dim);
        for (const [name, ground] of [["bg", g.bg], ["panel", g.panel], ["panel-2", g.panel2]] as const) {
          assert.ok(ratio(accent, ground) >= 4.5, `${s.id} accent on ${theme} ${name}: ${ratio(accent, ground).toFixed(2)}`);
          assert.ok(ratio(dim, ground) >= 4.5, `${s.id} dim on ${theme} ${name}: ${ratio(dim, ground).toFixed(2)}`);
        }
        const tint = over([accent[0], accent[1], accent[2], 0.2], g.panel2);
        assert.ok(ratio(accent, tint) >= 4.5, `${s.id} accent on accent/20 over ${theme} panel-2: ${ratio(accent, tint).toFixed(2)}`);
        assert.ok(ratio(accent, g.panel2) >= 3, `${s.id} focus ring vs ${theme} panel-2`);
      }
    });
  }
});

/* ---- the Sunroom ramp ------------------------------------------------------ */

const midday = SUNROOM_STOPS.findIndex((s) => s.name === "midday");
const night = SUNROOM_STOPS.findIndex((s) => s.dark === true);
const orchid = kioskAccentSwatch("orchid");

describe("sunroom ramp takes the swatch half", () => {
  it("day stop uses the light half, night stop the dark half, with Orchid", () => {
    const day = sunroomStateAt(midday, { accent: orchid });
    assert.equal(day.palette.accent, orchid.light.accent);
    assert.equal(day.palette.accentDim, orchid.light.dim);
    const dark = sunroomStateAt(night, { accent: orchid });
    assert.equal(dark.isDark, true);
    assert.equal(dark.palette.accent, orchid.dark.accent);
    assert.equal(dark.palette.accentDim, orchid.dark.dim);
  });
  it("the half swaps with the ink at the same moment", () => {
    for (let t = 0; t < SUNROOM_STOPS.length; t += 0.05) {
      const s = sunroomStateAt(t, { accent: orchid });
      const half = s.isDark ? orchid.dark : orchid.light;
      assert.equal(s.palette.accent, half.accent, `t=${t}`);
    }
  });
  it("with no swatch the output is byte-identical to the swatch-less call", () => {
    for (const t of [0, 0.4, 1, 2.5, 3, 4.5, 5.9]) {
      const none = sunroomStateAt(t, { cloud01: 0.3, rain01: 0.5 });
      const nullAccent = sunroomStateAt(t, { cloud01: 0.3, rain01: 0.5, accent: null });
      assert.deepEqual(nullAccent, none);
      // the ramp's own accent still comes straight from the nearer stop
      assert.equal(none.palette.accent, none.palette.blue);
    }
  });
  it("check 12: --sr-blue is the ramp's own accent, never the swatch", () => {
    for (const i of [midday, night]) {
      const plain = sunroomStateAt(i);
      const picked = sunroomStateAt(i, { accent: orchid });
      assert.equal(picked.palette.blue, plain.palette.accent);
      assert.notEqual(picked.palette.blue, picked.palette.accent);
      const vars = sunroomCssVars(picked, picked.light);
      assert.equal(vars["--sr-blue"], plain.palette.accent);
      assert.equal(vars["--sr-accent"], picked.palette.accent);
    }
  });
  it("globals.css reads --sr-blue with an accent fallback", () => {
    assert.match(css, /--color-blue: var\(--sr-blue, var\(--sr-accent\)\);/);
  });
  it("on-accent and focus keep the ramp's own values", () => {
    const plain = sunroomStateAt(midday);
    const picked = sunroomStateAt(midday, { accent: orchid });
    assert.equal(picked.palette.onAccent, plain.palette.onAccent);
    assert.equal(picked.palette.focus, plain.palette.focus);
  });
});

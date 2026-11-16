import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("Button: motion obeys prefers-reduced-motion (transition off with the press scale)", () => {
  assert.match(read("../ui/button.tsx"), /\btransition motion-reduce:transition-none\b/);
});

test("Kiosk night overlay: the Admin link is the 15 px DS micro size and keeps a 44 px target", () => {
  const src = read("./kiosk-display.tsx");
  assert.match(src, /absolute right-3 top-3 h-11 [^"]*text-\[15px\]/);
  assert.doesNotMatch(src, /top-3 h-11 [^"]*text-xs/);
});

test("Kiosk weather glyph: both readings pick it through currentGlyph (moon at night)", () => {
  assert.match(read("./kiosk-display.tsx"), /isNightGlyph\(code, sun\) \? Moon/);
  assert.match(read("./kiosk-surface.tsx"), /currentGlyph\(current\.code, weather\.ok\?\.sun\)/);
});

const header = () => {
  const s = read("./kiosk-surface.tsx");
  // the JSX tag, not the prose mentions of <header> in comments
  return s.slice(s.search(/<header\r?\n/), s.indexOf("</header>"));
};

test("Full view hero: the four FLIP nodes keep their registration and DOM order inside the header", () => {
  const h = header();
  const at = ["clock", "temp", "forecast", "server-line"].map((id) => h.indexOf(`flip.register("${id}")`));
  assert.ok(at.every((i) => i > 0), "all four registered in the header");
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  // the band is the new last child; the controls row is no longer a header child
  assert.ok(h.indexOf("<WeatherBand") > at[3]);
  assert.doesNotMatch(h, /KioskListButton|KioskDoorbellButton|KioskStatusStripExtras/);
});

test("Full view dock: a DOM sibling after the header (a themed panel's backdrop-filter would trap a fixed child), full only, fixed from lg", () => {
  const s = read("./kiosk-surface.tsx");
  const after = s.slice(s.indexOf("</header>"));
  assert.match(after, /\{full && \(\s*<div\s+data-rain-zone="dock"[^>]*lg:fixed/);
  assert.match(after, /<KioskListButton[\s\S]*<KioskDoorbellButton|<KioskDoorbellButton[\s\S]*<KioskListButton/);
  assert.match(s, /lg:sticky/);
});

test("Full view board: the elevated row renders only when elevated, as a span-12 row at the top of the board", () => {
  const s = read("./kiosk-surface.tsx");
  const full = s.slice(s.indexOf("function FullContent"));
  assert.match(full, /elevated && expiresAt !== null && \(\s*<Rise index=\{0\} className="[^"]*col-span-12/);
  assert.ok(full.indexOf("elevated && expiresAt") < full.indexOf("<KioskHub"));
  assert.match(s, /\{!full && <KioskNowPlaying/);
});

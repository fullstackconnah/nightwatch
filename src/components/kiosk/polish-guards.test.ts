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

test("Full view dock: Front door, Glance and Admin take Shopping's pane (border, so chips never print through them)", () => {
  const pane = /border border-line [^"]*hover:border-line-bright/;
  const s = read("./kiosk-surface.tsx");
  assert.match(s, /<KioskDoorbellButton[^>]*className="h-14 border border-line hover:border-line-bright"/);
  assert.match(s.slice(s.indexOf("Back to glance view")), pane);
  const strip = read("./kiosk-status-strip.tsx");
  assert.match(strip.slice(strip.indexOf("data-sr-admin")), pane);
  assert.match(read("./kiosk-list.tsx"), pane);
});

test("Full view dock: from lg every dock button has an opaque panel surface (chips scroll under the fixed dock); a running timer keeps its tint as a gradient layer", () => {
  const css = read("../../app/globals.css");
  assert.match(css, /@media \(min-width: 1024px\) \{\s*\[data-rain-zone="dock"\] button \{\s*background-color: var\(--color-panel\);/);
  const t = read("./kiosk-timers.tsx");
  assert.doesNotMatch(t, /border-warn\/50 bg-warn\/10/);
  assert.match(t, /border-warn\/50 bg-linear-to-r from-warn\/10 to-warn\/10/);
  assert.match(t, /border-accent\/40 bg-linear-to-r from-accent\/10 to-accent\/10/);
});

test("Full view cell header: the heading never wraps and the stale note truncates on the one row", () => {
  const s = read("./kiosk-hub.tsx");
  const h = s.slice(s.indexOf("function SectionHeader"), s.indexOf("const STALE_NOTE"));
  assert.match(h, /<h2 className="microlabel whitespace-nowrap">/);
  assert.match(h, /min-w-0 flex-1 truncate[^"]*@max-\[24rem\]:sr-only" title=\{note\}/);
  assert.match(h, /<StaleTag title=\{note\} \/>/);
});

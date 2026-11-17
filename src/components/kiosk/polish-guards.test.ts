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

// ---- fvpolish (2026-11-16): seven full view polish items ----
const hubChip = () => {
  const s = read("./kiosk-hub.tsx");
  return s.slice(s.indexOf("function ToggleChip"), s.indexOf("function SceneChip"));
};

test("fvpolish 2: an unavailable chip's sub text is never truncated and wraps under the name; other states keep their classes", () => {
  const c = hubChip();
  const unavail = c.match(/unavailable\s*\?\s*"(sr-chip-sub [^"]*)"/)?.[1] ?? "";
  assert.match(unavail, /shrink-0 whitespace-nowrap/);
  assert.doesNotMatch(unavail, /truncate|max-w-/);
  assert.match(c, /flex min-w-0 flex-wrap items-baseline/);
  assert.match(c, /sr-chip-sub min-w-0 max-w-24 shrink-\[8\] truncate/); // every other state is unchanged
  assert.match(c, /unavailable && "h-auto min-h-11/);
});

test("fvpolish 3: below 640 px the forecast wraps and shows every day; from 640 up the reveal points are unchanged", () => {
  const f = read("./kiosk-forecast.tsx");
  const full = f.slice(f.indexOf("  full: {"), f.indexOf("  glance: {"));
  assert.match(full, /revealFourth: "flex"/);
  assert.match(full, /revealFifth: "flex min-\[641px\]:max-\[679px\]:hidden"/);
  assert.match(f, /data-testid="kiosk-forecast-rail"[\s\S]{0,200}max-\[640px\]:flex-wrap/);
  assert.match(f.slice(f.indexOf("  glance: {"), f.indexOf("export function KioskForecastRail")), /revealFourth: "hidden min-\[640px\]:flex"/);
});

test("fvpolish 1 and 5: the auto-off pill clears the tiles by the tile gap; below 640 px it is on its own line and the row reserves the corner cluster", () => {
  const h = read("./kiosk-hub.tsx");
  const head = h.slice(h.indexOf("<SectionHeader icon={Thermometer}") - 400, h.indexOf("<ClimateAutoOffBanner"));
  assert.match(head, / pb-3\.5 [^"]*max-\[640px\]:pb-1 /);
  assert.match(head, /max-\[640px\]:flex-col max-\[640px\]:items-start/);
  assert.match(head, /max-\[640px\]:pr-\[calc\(2\*3\.5rem\+0\.75rem\)\]/);
  assert.match(read("./kiosk-climate-auto-off.tsx"), /-my-2\.5 max-\[640px\]:my-0/);
});

test("fvpolish 4 and 7: Aurora and Aerogel get an opaque backing under the panel colour on the pinned hero and the dock, above the motion block", () => {
  const css = read("../../app/globals.css");
  assert.match(css, /\[data-kiosk-theme="aurora"\] \[data-mode="full"\]\[data-pinned\]/);
  assert.match(css, /\[data-kiosk-theme="aerogel"\] \[data-mode="full"\]\[data-pinned\]/);
  const back = css.match(/\[data-kiosk-theme="aurora"\] \[data-rain-zone="dock"\] button,\s*\[data-kiosk-theme="aerogel"\] \[data-rain-zone="dock"\] button \{[^}]*\}/g) ?? [];
  assert.ok(back.some((b) => /linear-gradient\(var\(--tw-gradient-from[\s\S]*var\(--color-panel\)[\s\S]*background-color: var\(--color-bg\)/.test(b)), "dock backing keeps the timer tint gradient above the panel layer");
  assert.ok(css.lastIndexOf('[data-pinned]') < css.indexOf("/* nw motion */"));
  assert.ok(css.lastIndexOf('[data-rain-zone="dock"] button') < css.indexOf("/* nw motion */"), "every dock rule sits above the motion block");
  assert.match(read("./kiosk-surface.tsx"), /data-pinned=\{heroPinned \|\| undefined\}/);
});

test("fvpolish fix 1 item 1: an idle dock button keeps its hover background in Aurora and Aerogel (panel-2 over bg, tint stays the top layer)", () => {
  const css = read("../../app/globals.css");
  const hover = css.match(/@media \(hover: hover\) \{\s*\[data-kiosk-theme="aurora"\] \[data-rain-zone="dock"\] button:hover,\s*\[data-kiosk-theme="aerogel"\] \[data-rain-zone="dock"\] button:hover \{[^}]*\}/)?.[0] ?? "";
  assert.match(hover, /linear-gradient\(var\(--tw-gradient-from[\s\S]*linear-gradient\(var\(--color-panel-2\), var\(--color-panel-2\)\)/);
});

test("polish B item 2: the kiosk microlabel takes back one tracking unit per word gap (wide faces left a hole inside NOT)", () => {
  const css = read("../../app/globals.css");
  const rule = css.match(/\.kiosk-dense \.microlabel \{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /word-spacing: -0\.1em/);
  assert.ok(css.indexOf(rule) < css.indexOf("/* nw motion */"));
});

test("polish B item 3: PIN keypad digits take the Numerals face even where a button font shorthand would win", () => {
  // the digit key's own className (the one after its aria-label), not any later text
  assert.match(read("./kiosk-pin-pad.tsx"), /digit \$\{key\}`[\s\S]{0,900}?className="[^"]*sr-btn-nudge h-14[^"]*!font-mono[^"]*"/);
});

test("polish B item 4: the downloads pill is 56 px like the alert pill, and the open tray stops under the forecast rail", () => {
  const src = read("./kiosk-downloads.tsx");
  assert.match(src, /"flex h-14 min-w-14 [^"]*"/);
  assert.doesNotMatch(src, /min-h-14|py-2 text-ink-dim/);
  const cap = read("./kiosk-tray-cap.ts");
  assert.match(cap, /node\.style\.maxHeight = /);
  assert.match(cap, /Math\.max\(MIN_CAP, vh - bottom - top\)/);
  assert.match(cap, /slot\.getBoundingClientRect\(\)\.bottom \+ GAP_TO_SLOT/);
});

test("polish B item 5: below 641 px the bottom-left Glance cluster takes the lifted row the corner cluster uses", () => {
  const src = read("./kiosk-glance.tsx");
  const cluster = src.match(/className="fixed [^"]*"/)?.[0] ?? "";
  assert.match(cluster, /bottom-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(cluster, /max-\[640px\]:bottom-\[calc\(5\.25rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(read("./kiosk-surface.tsx"), /max-\[640px\]:bottom-\[calc\(5\.25rem\+env\(safe-area-inset-bottom\)\)\]/);
});

test("polish B item 6: every clock digit is a cell stacking all ten glyphs, and one sr-only string carries the time", () => {
  const src = read("./kiosk-clock.tsx");
  assert.match(src, /\[\.\.\."0123456789"\]/);
  assert.match(src, /inline-grid[^"]*"/);
  assert.match(src, /\[grid-area:1\/1\]/);
  assert.match(src, /<span className="sr-only">\{time\}<\/span>\s*<span aria-hidden>/);
  assert.match(src, /<ClockDigits time=\{clock\.time\} \/>/);
});

test("polish B item 7: the default marker is one text run with a space either side of the dot, in both chips", () => {
  const src = read("./kiosk-appearance.tsx");
  assert.equal((src.match(/> · default<\/span>/g) ?? []).length, 2);
  assert.doesNotMatch(src, />· default</);
});

test("hunt 54: the shared tray cap re-measures when the forecast slot resizes or the window does, and cleans up", () => {
  const src = read("./kiosk-tray-cap.ts");
  assert.match(src, /new ResizeObserver\(cap\)/);
  assert.match(src, /\.observe\(slot\)/);
  assert.match(src, /addEventListener\("resize", cap\)/);
  assert.match(src, /ro\?\.disconnect\(\)/);
  assert.match(src, /removeEventListener\("resize", cap\)/);
  assert.doesNotMatch(src, /shortcut: no resize listener/);
  assert.match(read("./kiosk-surface.tsx"), /data-testid="kiosk-forecast-slot"/);
});

test("tray cap: measured against the always-mounted slot, never the rail that unmounts with the pane", () => {
  const src = read("./kiosk-tray-cap.ts");
  assert.match(src, /kiosk-forecast-slot/);
  assert.doesNotMatch(src, /kiosk-forecast-rail/);
});

test("tray cap: the bottom follows the anchor button, 1rem above it, so a lifted button is never covered", () => {
  const src = read("./kiosk-tray-cap.ts");
  assert.match(src, /bottom = vh - anchor\.getBoundingClientRect\(\)\.top \+ GAP_TO_ANCHOR/);
  assert.match(src, /node\.style\.bottom = `\$\{bottom\}px`/);
  assert.match(src, /GAP_TO_ANCHOR = 16/);
});

test("tray cap: snaps to half a row and re-measures when the row count changes while open", () => {
  const src = read("./kiosk-tray-cap.ts");
  assert.match(src, /snapToHalfRow\(/);
  assert.match(src, /\[open, rowCount, anchorRef, nodeRef\]/);
});

test("both corner trays use the shared cap, contain their overscroll", () => {
  for (const f of ["./kiosk-downloads.tsx", "./kiosk-alerts.tsx"]) {
    const src = read(f);
    assert.match(src, /useTrayCap\(nodeRef, anchorRef, open, /, f);
    assert.match(src, /overflow-y-auto overscroll-contain/, f);
  }
});

test("downloads tray: a tap on its body closes it (rows are read-only); the stale comment is gone", () => {
  const src = read("./kiosk-downloads.tsx");
  assert.match(src, /onClick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*onClose\(\);\s*\}\}/);
  assert.doesNotMatch(src, /only\s+\/\/ closes on Escape or its own 20s timeout/);
});

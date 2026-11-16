import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fitChips, foldedOn } from "./glance-fit.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// fitChips(widths, limit, gap, moreW): how many chips stay when the rest fold into one +n chip.
test("fitChips: no chips shows none", () => {
  assert.equal(fitChips([], 300, 12, 56), 0);
});
test("fitChips: one chip that fits is shown, no +n", () => {
  assert.equal(fitChips([120], 300, 12, 56), 1);
});
test("fitChips: chips that fit exactly are all shown (gaps counted, no +n)", () => {
  assert.equal(fitChips([100, 100, 100], 324, 12, 56), 3);
  assert.equal(fitChips([100, 100, 100], 323, 12, 56), 2);
});
test("fitChips: overflow keeps the chips that fit beside the +n chip", () => {
  // 100 + 12 + 100 + 12 + 56 = 280 <= 300; a third chip would need 392
  assert.equal(fitChips([100, 100, 100, 100], 300, 12, 56), 2);
});
test("fitChips: nothing fits shows none (only +n)", () => {
  assert.equal(fitChips([100, 100], 40, 12, 56), 0);
});

const glance = () => read("./kiosk-glance.tsx");
const surface = () => read("./kiosk-surface.tsx");
const LIFT = "data-\\[lifted\\]:bottom-\\[calc\\(5\\.25rem\\+env\\(safe-area-inset-bottom\\)\\)\\]";

test("Glance cluster: keeps today's offsets and lifts above the pill at every width while it plays", () => {
  const g = glance();
  assert.match(g, /className="fixed bottom-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(g, /max-\[640px\]:bottom-\[calc\(5\.25rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(g, new RegExp(LIFT));
  assert.match(g, /data-lifted=\{lifted \|\| undefined\}/);
});

test("Alert and downloads cluster lifts with the pill too", () => {
  assert.match(surface(), new RegExp(LIFT));
  assert.match(surface(), /data-lifted=\{npOn \|\| undefined\}/);
});

test("Glance column reserves the pill's row only while it shows", () => {
  assert.match(surface(), /npOn && !full && "pb-\[calc\(4\.25rem\+env/);
});

test("Pill reports when it is on screen and the surface listens", () => {
  assert.match(read("./kiosk-now-playing.tsx"), /onVisibleChange\?\.\(/);
  assert.match(surface(), /<KioskNowPlaying onVisibleChange=\{setNpOn\} \/>/);
});

test("Folded lights: a +n chip in the same chip class opens the Full view", () => {
  const g = glance();
  assert.match(g, /fitChips\(/);
  assert.match(g, /onMore\(\)/);
  assert.match(g, /GLANCE_CHIP/);
  assert.match(g, /aria-label=\{`Show all \$\{/);
  assert.match(surface(), /onMore=\{onInteraction\}/);
});

test("Scene wrappers are findable so the cluster can measure its limit", () => {
  assert.match(glance(), /data-glance-widget=\{id\}/);
});

test("fitChips: one chip wider than the limit folds to +1 (it cannot fit anywhere)", () => {
  assert.equal(fitChips([200], 100, 12, 56), 0);
});
test("fitChips: a limit below the +n width with chips present shows none", () => {
  assert.equal(fitChips([100, 100], 50, 12, 56), 0);
});
test("fitChips: a +1 never hides a chip that would fit in the +n slot", () => {
  // Folding exactly one chip means everything before it fits beside +n; a last chip no wider than +n then fits too, so all show.
  assert.equal(fitChips([100, 56], 168, 12, 56), 2);
  assert.equal(fitChips([100, 57], 168, 12, 56), 1);
});
test("fitChips: unmeasured (zero) widths show every chip", () => {
  assert.equal(fitChips([0, 0, 0], 200, 12, 56), 3);
});

test("foldedOn counts the lit lights past the shown ones", () => {
  const l = (on: boolean) => ({ on });
  assert.equal(foldedOn([l(true), l(false), l(false)], 1), 0);
  assert.equal(foldedOn([l(false), l(true), l(false)], 1), 1);
  assert.equal(foldedOn([l(false), l(true), l(true)], 1), 2);
  assert.equal(foldedOn([l(true), l(true)], 2), 0);
});

test("Folded lights: the rendered list is the fitChips result, and +n shows the on tone and count", () => {
  const g = glance();
  assert.match(g, /const next = fitChips\(/);
  assert.match(g, /\{ key, k: next \}/);
  assert.match(g, /fit\.k : lights\.length/);
  assert.match(g, /lights\.slice\(0, k\)\.map\(/);
  assert.match(g, /foldedOn\(lights, k\)/);
  assert.match(g, /lights, M on|\$\{foldOn\} on/);
  assert.match(g, /foldOn > 0 \? "border-accent\/40 bg-accent\/10 text-accent" : CHIP_OFF/);
});

test("Scene row stays in the column's flow; the column reserves the band while the pill plays", () => {
  const g = glance();
  assert.doesNotMatch(g, /lifted && id === "scenes"/);
  assert.doesNotMatch(g, /fixed inset-x-0/);
  const s = surface();
  assert.match(s, /npOn && !full && "pb-\[calc\(4\.25rem\+env\(safe-area-inset-bottom\)\)\] max-\[640px\]:pb-\[calc\(8\.5rem\+env\(safe-area-inset-bottom\)\)\]"/);
  assert.match(s, /!full && !npOn && "max-\[640px\]:pb-\[calc\(5\.25rem/);
});

test("Playing on a short screen: column, header gap and clock take the 700px steps at 800px, keyed on the pill", () => {
  const s = surface();
  assert.match(s, /data-np=\{npOn && !full \? "" : undefined\}/);
  assert.match(s, /text-center \[@media\(max-height:800px\)\]:gap-3"/); // column gap: every state, not only playing
  assert.doesNotMatch(s, /npOn && !full && "\[@media\(max-height:800px\)\]:gap-3"/);
  assert.match(s, /group-data-\[np\]\/col:\[@media\(max-height:800px\)\]:gap-2\.5/);
  assert.match(read("./kiosk-clock.tsx"), /group-data-\[np\]\/col:\[@media\(max-height:800px\)\]:!text-\[4\.5rem\]/);
});

test("Chip widths re-measure when fonts finish loading or the typeface changes", () => {
  const g = glance();
  assert.match(g, /document\.fonts\.addEventListener\("loadingdone"/);
  assert.match(g, /document\.fonts\.removeEventListener\("loadingdone"/);
  assert.match(g, /useKioskFonts\(useKioskTheme\(\)\)/);
});

test("Pill reports visibility in a layout effect (same frame as the lift)", () => {
  assert.match(read("./kiosk-now-playing.tsx"), /useLayoutEffect\(\(\) => \{\s*onVisibleChange\?\.\(visible\)/);
});

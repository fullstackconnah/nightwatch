import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fitChips } from "./glance-fit.ts";

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
  assert.match(surface(), /npOn && !full && "pb-\[calc\(3rem\+env\(safe-area-inset-bottom\)\)\]"/);
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

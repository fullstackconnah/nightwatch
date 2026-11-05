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

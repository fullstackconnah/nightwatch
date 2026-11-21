import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const count = (s: string, needle: string) => s.split(needle).length - 1;

test("pack-browser has one persistent status region holding the one Searching… note", () => {
  const s = src("components/minecraft/pack-browser.tsx");
  assert.equal(count(s, 'role="status"'), 1);
  assert.equal(count(s, "Searching…"), 1);
  const region = s.slice(s.indexOf('role="status"'), s.indexOf("</div>", s.indexOf('role="status"')));
  assert.match(region, /Searching…/);
  assert.match(region, /providerNote/);
});

test("log-detail status region holds the strip text and the polled log sits after it", () => {
  const s = src("components/minecraft/log-detail.tsx");
  assert.equal(count(s, 'role="status"'), 1);
  assert.doesNotMatch(s, /aria-live/);
  const at = s.indexOf('role="status"');
  const after = /<\/div>\s*\{!empty && logs\}/.exec(s.slice(at));
  assert.ok(after, "log text follows the closing tag of the status div");
  const inside = s.slice(at, at + after.index);
  assert.match(inside, /Couldn&apos;t refresh\./);
  assert.match(inside, /empty\.text/);
  assert.doesNotMatch(inside, /!empty && logs/);
});

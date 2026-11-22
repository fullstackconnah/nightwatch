import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const count = (s: string, needle: string) => s.split(needle).length - 1;

const settings = ["components/settings/settings-access.tsx", "components/settings/settings-integrations.tsx"];

test("save-row errors are role=alert, not plain spans", () => {
  for (const f of settings) {
    const tags = [...src(f).matchAll(/<span\b[^>]*\btext-bad\b[^>]*>\s*\{error\}/g)].map((m) => m[0]);
    assert.ok(tags.length >= 5, `${f}: found ${tags.length} error spans`);
    for (const t of tags) assert.ok(t.includes('role="alert"'), `${f}: ${t}`);
  }
});

test("every saved badge has an always-mounted sr-only status announcer and is aria-hidden", () => {
  for (const f of settings) {
    const s = src(f);
    const badges = count(s, ">saved</Badge>");
    assert.ok(badges > 0, f);
    assert.equal(count(s, '<span role="status" className="sr-only">'), badges, f);
    assert.equal(count(s, '<Badge variant="ok" aria-hidden'), badges, f);
  }
});

test("console output box is a log region", () => {
  assert.ok(src("components/minecraft/console.tsx").includes('role="log"'));
});

test("pack-browser outcome lines sit inside the role=status region", () => {
  const s = src("components/minecraft/pack-browser.tsx");
  const open = s.indexOf('<div role="status" className="contents">');
  const close = s.indexOf("</div>", open);
  assert.ok(open > 0);
  for (const t of ["No results.", "Couldn&apos;t search"]) {
    const i = s.indexOf(t);
    assert.ok(i > open && i < close, `${t} must be inside the status region`);
  }
});

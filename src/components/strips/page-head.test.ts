import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("PageHead takes an optional action in the link's slot; link and action never both render (C17)", () => {
  const src = read("./page-head.tsx");
  assert.match(src, /action\?: ReactNode/);
  assert.match(src, /\{action \?\? \(link && /);
});

test("Minecraft and Smart home pass no action, so they render as before", () => {
  for (const rel of ["../../app/(dash)/smarthome/page.tsx", "../../app/(dash)/minecraft/page.tsx"]) {
    assert.ok(!/<PageHead[^>]*\baction=/.test(read(rel)), rel);
  }
});

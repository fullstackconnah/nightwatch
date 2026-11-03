import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/resources/container-controls.tsx", import.meta.url), "utf8");

test("no lifecycle verb is danger-coloured at rest", () => {
  assert.doesNotMatch(src, /variant:\s*"danger"/);
});

test("the stop tone has no bad or warn hue", () => {
  const line = src.split(/\r?\n/).find((l) => /^\s*stop:\s*"/.test(l));
  assert.ok(line, "ACTION_TONE stop entry exists");
  assert.doesNotMatch(line, /\b(bad|warn)\b/);
});

test("ConfirmStop's Yes names the container", () => {
  const i = src.indexOf("export function ConfirmStop");
  assert.ok(i >= 0, "ConfirmStop exists");
  assert.match(src.slice(i), /aria-label=\{`Yes, stop \$\{name\}`\}/);
});

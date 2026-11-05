import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DIRS = ["components/settings", "app/(dash)/settings"];
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.tsx?$/.test(n) ? [join(d, n)] : []));
const files = DIRS.flatMap((d) => walk(join(SRC, d)));
const text = files.map((f) => readFileSync(f, "utf8")).join("\n");

test("C2s: the page keeps its 12 write call sites and 6 URLs", () => {
  const calls = [...text.matchAll(/\b(?:postJson|putJson)\(\s*(["`])([^"`]+)\1/g)];
  assert.equal(calls.length, 12);
  assert.deepEqual([...new Set(calls.map((c) => c[2]))].sort(), [
    "/api/hermes/model",
    "/api/settings",
    "/api/settings/hermes-daemon",
    "/api/settings/integrations",
    "/api/settings/password",
    "/api/settings/system",
  ]);
});

test("C13: the data path is never shown (meta.dataDir is not read)", () => {
  assert.doesNotMatch(text, /\bdataDir\b(?!: string)/);
});

test("C11: nothing points at the removed #integrations section", () => {
  const all = walk(SRC).filter((f) => !/\.test\.ts$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
  assert.doesNotMatch(all, /settings#integrations/);
});

test("S1/S2: a save or clear reloads the fields from the stored values", () => {
  const integ = readFileSync(join(SRC, "components/settings/settings-integrations.tsx"), "utf8");
  assert.equal([...integ.matchAll(/useIntegrationWrite\(mutate, \(\) => setSeeded\(false\)\)/g)].length, 4);
  assert.match(integ, /await mutate\(\);\s*reseed\?\.\(\);[\s\S]*await mutate\(\);\s*reseed\?\.\(\);/);
  const access = readFileSync(join(SRC, "components/settings/settings-access.tsx"), "utf8");
  assert.equal([...access.matchAll(/await mutate\(\);\s*setSeeded\(false\);/g)].length, 2);
});

test("N3: the confirm sentences are the spec's words", () => {
  const access = readFileSync(join(SRC, "components/settings/settings-access.tsx"), "utf8");
  assert.match(access, /Makes a new MCP token\. Clients using the old one stop working until you give them the new one\./);
  assert.match(access, /Removes the saved Orchestra token\. The AI lanes page can't reach it until you enter one again\./);
});

test("icon-only delete buttons carry an accessible name", () => {
  const w = readFileSync(join(SRC, "components/settings/settings-widgets.tsx"), "utf8");
  assert.match(w, /aria-label=\{`Delete widget \$\{w\.container\}`\}/);
  assert.match(w, /aria-label=\{`Remove field \$\{f\.label \|\| f\.path\}`\}/);
});

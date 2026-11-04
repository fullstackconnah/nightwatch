import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const DIRS = [
  join("app", "(dash)", "minecraft"),
  join("components", "minecraft"),
  join("components", "strips"),
  join("lib", "minecraft"),
  join("app", "api", "minecraft"),
];
const QUAD = /\b\d{1,3}(\.\d{1,3}){3}\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.ts$/.test(e)) out.push(p);
  }
  return out;
}

test("C3: no dotted-quad address in the Minecraft code or copy", () => {
  const hits: string[] = [];
  for (const d of DIRS) {
    for (const f of walk(join(SRC, d))) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (QUAD.test(line)) hits.push(`${f.slice(SRC.length)}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(hits, []);
});

test("C3: the config snippet and its component are gone", () => {
  const page = readFileSync(join(SRC, "app", "(dash)", "minecraft", "page.tsx"), "utf8");
  assert.doesNotMatch(page, /CONFIG_SNIPPET|MinecraftUnconfigured|data\/config\.json/);
});

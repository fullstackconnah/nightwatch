import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
// PR 4 covers /hermes; PR 5 extends this list to /git and /proxy.
const DIRS = [join("app", "(dash)", "hermes"), join("lib", "hermes"), join("app", "api", "hermes-ctl")];
const FILES = [
  join("lib", "integration-head.ts"),
  join("lib", "hermes-ctl.ts"),
  join("lib", "use-hermes.ts"),
  ...readdirSync(join(SRC, "components", "integrations")).filter((f) => f.startsWith("hermes-")).map((f) => join("components", "integrations", f)),
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

test("C18: no dotted-quad address in the Hermes code or copy", () => {
  const hits: string[] = [];
  const files = [...DIRS.flatMap((d) => walk(join(SRC, d))), ...FILES.map((f) => join(SRC, f))];
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (QUAD.test(line)) hits.push(`${f.slice(SRC.length)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

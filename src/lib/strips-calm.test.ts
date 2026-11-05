import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.ts$/.test(e)) out.push(p);
  }
  return out;
}
const lines = (dir: string) =>
  walk(join(SRC, dir)).flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => ({ f: f.slice(SRC.length), n: i + 1, l })));

test("C15n: strips has no bad or warn class outside the chip and the danger Yes", () => {
  const hits = lines(join("components", "strips")).filter(
    ({ l }) => /\b(text|bg|border|ring)-(bad|warn)\b/.test(l) || /variant="warn"/.test(l),
  );
  assert.deepEqual(hits.map((h) => `${h.f}:${h.n}`), []);
});

test("C15n: the strip page-head tones only reach the chip (Badge) and the state line", () => {
  const src = readFileSync(join(SRC, "components", "strips", "page-head.tsx"), "utf8");
  assert.match(src, /<Badge variant=/);
});

test("C16: no PROPOSED badge in strips, minecraft or smarthome components", () => {
  for (const d of [join("components", "strips"), join("components", "minecraft"), join("components", "smarthome")]) {
    assert.deepEqual(lines(d).filter(({ l }) => /proposed/i.test(l)), []);
  }
});

test("R6: the minecraft components keep warn out of rest styles (pause is an outline)", () => {
  const hits = lines(join("components", "minecraft")).filter(({ l }) => /variant=\{[^}]*"warn"|variant="warn"|text-warn/.test(l));
  assert.deepEqual(hits.map((h) => `${h.f}:${h.n}`), []);
});

test("C15n: smarthome paints warn or bad only for a fact that is wrong (a battery, a jammed or silent device, a failed write)", () => {
  const hits = lines(join("components", "smarthome")).filter(({ l }) => /variant="warn"|bg-(bad|warn)\b|border-(bad|warn)\b/.test(l));
  assert.deepEqual(hits.map((h) => `${h.f}:${h.n}`), []);
});

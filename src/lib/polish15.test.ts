import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sparkPaths } from "./chart-points.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("H116-1: root error Retry reloads the page", () => {
  const src = read("../app/global-error.tsx");
  assert.match(src, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
  assert.ok(!src.includes("onClick={reset}"));
});

test("H116-2: a successful write refocuses the trigger only when focus fell to body", () => {
  const src = read("../components/strips/write-action.tsx");
  assert.match(src, /await run\(\);\s*\/\/[^\r\n]*\s*if \(!document\.activeElement \|\| document\.activeElement === document\.body\) refocus\.current = true;\s*setPhase\("idle"\)/);
});

test("H116-3: non-finite samples are dropped", () => {
  const r = sparkPaths([1, NaN, 3], undefined, 240, 48);
  assert.ok(r && !r.line.includes("NaN") && !r.area.includes("NaN"));
  assert.equal(r.line.split(" ").length, 2);
  assert.equal(sparkPaths([NaN, NaN], undefined, 240, 48), null);
  assert.equal(sparkPaths([1, Infinity], undefined, 240, 48), null);
  assert.equal(sparkPaths([], undefined, 240, 48), null);
});

test("H116-3: a normal series is unchanged and a bad max falls back", () => {
  const r = sparkPaths([0, 50, 100], 100, 240, 48);
  assert.equal(r?.line, "0.0,45.0 120.0,25.0 240.0,5.0");
  assert.equal(r?.area, "0,48 0.0,45.0 120.0,25.0 240.0,5.0 240,48");
  for (const bad of [0, NaN, -5, Infinity]) {
    const f = sparkPaths([0, 50, 100], bad, 240, 48);
    assert.equal(f?.line, sparkPaths([0, 50, 100], undefined, 240, 48)?.line);
    assert.ok(!f?.line.includes("NaN"));
  }
});

test("H116-6: sparkline svg is hidden from AT; route errors announce", () => {
  assert.match(read("../components/charts.tsx"), /<svg\s+aria-hidden="true"/);
  for (const f of ["../app/global-error.tsx", "../app/(dash)/error.tsx"]) {
    assert.match(read(f), /<div role="alert" className="flex flex-col gap-1\.5">/);
  }
});

test("H115-1: RCON host input is capped by the server constant", () => {
  const src = read("../components/settings/settings-integrations.tsx");
  assert.match(src, /maxLength=\{MAX_RCON_HOST\}/);
  assert.match(src, /import \{ MAX_RCON_HOST \} from "@\/lib\/settings-checks"/);
});

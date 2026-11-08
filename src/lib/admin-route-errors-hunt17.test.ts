import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { removeErrorCopy } from "./container-remove.ts";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../app/api/${rel}`, import.meta.url)), "utf8");

const ROUTES = [
  "docker/containers/route.ts",
  "docker/containers/[id]/route.ts",
  "docker/containers/[id]/logs/route.ts",
  "docker/containers/[id]/stats/route.ts",
  "docker/containers/[id]/action/route.ts",
  "resources/route.ts",
  "resources/contents/route.ts",
  "resources/disk-usage/route.ts",
  "resources/growth/route.ts",
  "resources/pins/route.ts",
];

test("B1: admin routes never put raw error text in a response body", () => {
  for (const r of ROUTES) {
    const src = read(r);
    assert.doesNotMatch(src, /^.*\berror:.*(\be\.message|\(e as Error\)\.message|String\(e\))/m, `${r}: error: carries e.message`);
    assert.doesNotMatch(src, /^.*\$\{message\}/m, `${r}: template echoes message`);
    assert.doesNotMatch(src, /^.*removeErrorCopy\([^)]*message/m, `${r}: removeErrorCopy gets message`);
    assert.doesNotMatch(src, /^\s*\? e\.message \+/m, `${r}: e.message concatenated`);
  }
});

test("B1: removeErrorCopy never echoes the raw Docker message", () => {
  // The helper takes no message any more, so none can leak; the copy stays free of hosts and paths.
  for (const s of ["ECONN", 500] as const) {
    assert.doesNotMatch(removeErrorCopy(s, "web"), /ENOTFOUND|10\.0\.0\.1|\/srv/);
  }
});

test("B2: minecraft delete and activate refuse a slug that sanitizeSlug would change", () => {
  for (const r of ["minecraft/instances/[slug]/route.ts", "minecraft/instances/[slug]/activate/route.ts"]) {
    const src = read(r);
    assert.match(src, /^\s+if \(sanitizeSlug\(slug\) !== slug\) \{$/m, r);
    assert.match(src, /^\s+return NextResponse\.json\(\{ error: "invalid instance slug" \}, \{ status: 400 \}\);$/m, r);
  }
});

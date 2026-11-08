import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("container page counts failed stats polls through the helper", () => {
  const src = read("../app/(dash)/containers/[id]/page.tsx");
  assert.match(src, /nextFailCount\(/);
  assert.match(src, /^\s+if \(alive && fails >= STATS_STALE_AFTER\) setHistory\(\[\]\);\s*$/m);
});

test("disk contents root branch reads the scan error", () => {
  const src = read("../components/resources/disk-contents.tsx");
  assert.match(src, /^\s+error: rootError,\s*$/m);
  assert.match(src, /^\s+const loadError = atRoot \? rootError : dirError;\s*$/m);
  assert.match(src, /^\s+if \(loadError && !scan\) \{\s*$/m);
});

test("disk growth shows its own error copy", () => {
  const src = read("../components/resources/disk-growth.tsx");
  assert.match(src, /const \{ data, error, isLoading \} = useSWR/);
  assert.match(src, /could not load growth history/);
});

test("disk pinned renders a rescan failure in PinError", () => {
  const src = read("../components/resources/disk-pinned.tsx");
  assert.match(src, /^\s+\{refreshError && <PinError>\{refreshError\}<\/PinError>\}\s*$/m);
  assert.match(src, /setRefreshError\(/);
});

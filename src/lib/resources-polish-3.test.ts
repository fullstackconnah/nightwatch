import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("resources page hides the totals strip when the load failed", () => {
  const src = read("../app/(dash)/resources/page.tsx");
  assert.match(src, /^\s+\{!\(historyMetric \|\| allActive\) && load !== "failed" && \(\s*$/m);
});

test("unreadable disk row explains itself in a visible second line, not a title", () => {
  const src = read("../components/resources/disk-contents.tsx");
  assert.match(src, /<div key=\{r\.key\} className=/);
  assert.doesNotMatch(src, /<div key=\{r\.key\} title=/);
  assert.match(src, /<span className="microlabel !normal-case !tracking-normal [^"]*">\{r\.title\}<\/span>/);
  assert.match(src, /title=\{r\.title \?\? `/); // stacked-bar title guard
});

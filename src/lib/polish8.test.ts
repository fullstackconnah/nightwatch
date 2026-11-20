import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Components cannot be imported under node:test (React, "@/" alias), so these pin the source.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

test("Needs you shows its count only once a report exists", () => {
  const s = read("../components/home/attention-list.tsx");
  assert.match(s, /\{report && <span className="font-mono text-xs text-ink-dim">\{display\.length\}<\/span>\}/);
  assert.doesNotMatch(s, /^\s*<span className="font-mono text-xs text-ink-dim">\{display\.length\}/m);
});

test("the Disks line wraps before the dot and never inside an item", async () => {
  const { diskLine } = await import("./home.ts");
  const d = (mount: string, percent: number) => ({ mount, percent });
  const two = diskLine([d("/", 41), d("/mnt/sda", 65)]);
  assert.equal(two, "root\u00a041% ·\u00a0sda\u00a065%");
  for (const item of two.split(" ·\u00a0")) assert.doesNotMatch(item, / /);
  assert.equal(diskLine([d("/", 41)]), "root\u00a041%");
});

test("the / hint is hidden below md", () => {
  const s = read("../components/home/launcher.tsx");
  assert.match(s, /<kbd\s+data-feature="slash-key"[^>]*className="hidden md:block /);
});

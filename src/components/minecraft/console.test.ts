import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

it("every setLines append in the RCON console keeps only the last 500 entries", () => {
  const src = readFileSync(new URL("./console.tsx", import.meta.url), "utf8");
  assert.match(src, /const SCROLLBACK = 500;/);
  assert.match(src, /\[\.\.\.l, entry\]\.slice\(-SCROLLBACK\)/);
  assert.equal((src.match(/setLines\(\(l\) => append\(l,/g) ?? []).length, 3);
  assert.equal((src.match(/setLines\(\(l\) => \[/g) ?? []).length, 0, "no uncapped append remains");
});

it("the console takes its hint from consoleHint and the page passes whether the server is running", () => {
  const src = readFileSync(new URL("./console.tsx", import.meta.url), "utf8");
  assert.match(src, /consoleHint\(rcon, running, Boolean\(stale\)\)/);
  assert.match(src, /const disabled = hint !== null;/);
  const page = readFileSync(new URL("../../app/(dash)/minecraft/page.tsx", import.meta.url), "utf8");
  assert.match(page, /running=\{container\?\.state === "running"\}/);
});

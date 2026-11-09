import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { networkSummary } from "./network-copy.ts";

test("networkSummary pluralises 0, 1 and 2", () => {
  assert.equal(networkSummary(0, 0, 0), "0 interfaces · 0 listening ports · 0 remote peers");
  assert.equal(networkSummary(1, 1, 1), "1 interface · 1 listening port · 1 remote peer");
  assert.equal(networkSummary(2, 2, 2), "2 interfaces · 2 listening ports · 2 remote peers");
});

test("network page uses networkSummary, no fixed plural header", () => {
  const page = readFileSync(new URL("../app/(dash)/networks/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /\} interfaces ·/);
  assert.match(page, /networkSummary\(/);
});

test("every warning phrase in network.ts is a sentence", () => {
  const src = readFileSync(new URL("./network.ts", import.meta.url), "utf8");
  const lits = [...src.matchAll(/(?:warnings\.push|warn\(warnings,)\s*\(?\s*([`"])((?:(?!\1).)*)\1/g)].map((m) => m[2]);
  assert.equal(lits.length, 7);
  for (const l of lits) assert.match(l, /^[A-Z].*\.$/, l);
});

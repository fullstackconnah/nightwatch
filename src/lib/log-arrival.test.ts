import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { pickArrived, countNewLines } from "./log-arrival.ts";

const L = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c:l${i}` }));

describe("pickArrived with the effect that marks arrivals seen", () => {
  it("announces and animates each live line once", () => {
    const seen = new Set<string>();
    let lines = L(1);
    let arrived = pickArrived(lines, seen, true);
    assert.equal(arrived.size, 1);
    for (const id of arrived) seen.add(id); // the effect below the announce effect
    lines = L(2);
    arrived = pickArrived(lines, seen, true);
    assert.equal(arrived.size, 1, "the first line is not announced again");
    assert.ok(arrived.has("c:l1"));
  });
  it("a filter or level toggle with no new lines arrives nothing", () => {
    const seen = new Set(["c:l0", "c:l1"]);
    assert.equal(pickArrived(L(2).slice(1), seen, true).size, 0);
    assert.equal(pickArrived(L(2), seen, true).size, 0);
  });
  it("nothing arrives before the seed latches", () => {
    assert.equal(pickArrived(L(3), new Set(), false).size, 0);
  });
});

describe("countNewLines", () => {
  it("counts growth under the cap", () => {
    assert.equal(countNewLines("c:l4", L(8)), 3);
    assert.equal(countNewLines("c:l7", L(8)), 0);
  });
  it("counts new lines when a full buffer drops old ones", () => {
    const before = L(2000);
    const after = [...before.slice(3), ...[2000, 2001, 2002].map((i) => ({ id: `c:l${i}` }))];
    assert.equal(after.length, 2000);
    assert.equal(countNewLines(before[1999].id, after), 3);
  });
  it("counts every line when the previous last line has dropped out", () => {
    assert.equal(countNewLines("gone", L(5)), 5);
  });
  it("an empty buffer has none", () => {
    assert.equal(countNewLines("c:l0", []), 0);
  });
});

describe("log-track uses them", () => {
  const src = readFileSync(new URL("../components/logs/log-track.tsx", import.meta.url), "utf8");
  it("calls both helpers and marks arrivals seen after the announce effect", () => {
    assert.match(src, /countNewLines\(/);
    assert.match(src, /pickArrived\(filtered, seenIds\.current, seededRef\.current\)/);
    const announce = src.indexOf("setAnnouncement((prev) => ({ text: `${container}:");
    const mark = src.indexOf("seenIds.current.add(id)");
    assert.ok(announce > 0 && mark > announce, "seen is marked in an effect declared below the announce effect");
  });
});

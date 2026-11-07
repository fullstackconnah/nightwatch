import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_PARTIAL, splitLines } from "./log-split.ts";

/** Feed chunks the way feedText does; returns every emitted line and the final remainder. */
function feed(chunks: string[]) {
  const out: string[] = [];
  let rest = "";
  let maxRest = 0;
  for (const c of chunks) {
    const r = splitLines(rest + c);
    out.push(...r.lines);
    rest = r.rest;
    maxRest = Math.max(maxRest, rest.length);
  }
  return { out, rest, maxRest };
}

describe("splitLines", () => {
  it("200 KB of x\\r chunks with no LF emits lines and keeps the partial small", () => {
    const r = feed(Array.from({ length: 100_000 }, () => "x\r"));
    assert.ok(r.out.length > 0);
    assert.ok(r.maxRest <= MAX_PARTIAL);
  });
  it("a long line with no newline is emitted once past the cap", () => {
    const r = feed(["y".repeat(MAX_PARTIAL), "y"]);
    assert.equal(r.out.length, 1);
    assert.equal(r.rest, "");
  });
  it("bare CRs split lines", () => {
    assert.deepEqual(feed(["a\rb\r", "c\n"]).out, ["a", "b", "c"]);
  });
  it("a CRLF split across chunks gives no empty line", () => {
    assert.deepEqual(feed(["a\r", "\nb\n"]).out, ["a", "b"]);
  });
});
describe("cap emit", () => {
  it("a capped line ending in CR drops the CR", () => {
    const r = splitLines("z".repeat(70 * 1024) + "\r");
    assert.equal(r.lines.length, 1);
    assert.ok(!r.lines[0].endsWith("\r"));
  });
});

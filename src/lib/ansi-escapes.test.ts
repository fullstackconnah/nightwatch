import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANSI_SEQUENCE, ESC, stripAnsi } from "./ansi-escapes.ts";

describe("ansi escapes", () => {
  it("strips private-mode CSI sequences", () => {
    assert.equal(stripAnsi("a" + ESC + "[?25lb"), "ab");
    assert.equal(stripAnsi("a" + ESC + "[?1049hb" + ESC + "[>4;1mc"), "abc");
  });
  it("still recognises SGR with final m", () => {
    const m = new RegExp(ANSI_SEQUENCE.source, "g").exec(ESC + "[31mred");
    assert.ok(m);
    assert.equal(m[1], "31");
    assert.equal(m[2], "m");
    assert.equal(stripAnsi(ESC + "[31mred"), "red");
  });
  it("strips cursor movement and erase finals", () => {
    assert.equal(stripAnsi("x" + ESC + "[2K" + ESC + "[1Ay"), "xy");
  });
});

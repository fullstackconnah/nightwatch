import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

describe("media file columns", () => {
  it("the header and the file rows share one track list, with one area per track", () => {
    const rule = css.match(/\.st-wide \.md-cols, \.st-wide \.md-file \{[^}]*\}/);
    assert.ok(rule, "header and rows are styled by one rule");
    const tracks = rule[0].match(/grid-template-columns:\s*([^;]+);/)?.[1].replace(/minmax\([^)]*\)/g, "1fr").trim().split(/\s+/) ?? [];
    assert.ok(!tracks.includes("auto"), "no unused auto track");
    const areas = css.match(/\.st-wide \.md-file \{[^}]*grid-template-areas:\s*"([^"]+)"/)?.[1].split(/\s+/);
    assert.equal(areas?.length, tracks.length);
  });
});

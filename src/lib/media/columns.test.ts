import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

describe("media file columns", () => {
  it("the header and the file rows share one track list, with one area per track", () => {
    const rule = css.match(/\.st-wide \.md-cols, \.st-wide \.md-file \{[^}]*\}/);
    assert.ok(rule, "header and rows are styled by one rule");
    const tracks = rule[0].match(/grid-template-columns:\s*([^;]+);/)?.[1].replace(/minmax\([^)]*\)/g, "1fr").trim().split(/\s+/) ?? [];
    assert.equal(tracks.at(-1), "auto", "the last track is the file action");
    const areas = css.match(/\.st-wide \.md-file \{[^}]*grid-template-areas:\s*"([^"]+)"/)?.[1].split(/\s+/);
    assert.equal(areas?.length, tracks.length);
    assert.equal(areas?.at(-1), "act");
    assert.equal(tracks.filter((t) => t === "auto").length, 1, "only the action track is auto");
  });
});

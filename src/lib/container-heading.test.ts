import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { containerHeading } from "./container-heading.ts";

const HEX = "ab12cd34ef56" + "0".repeat(52);

describe("containerHeading", () => {
  it("1: a name wins over the id", () => {
    assert.equal(containerHeading("demo-exited", HEX), "demo-exited");
  });
  it("2: a null or empty name with a 64-hex id gives the 12-char short id", () => {
    assert.equal(containerHeading(null, HEX), "ab12cd34ef56");
    assert.equal(containerHeading(undefined, HEX), "ab12cd34ef56");
    assert.equal(containerHeading("", HEX), "ab12cd34ef56");
  });
  it("3: an uppercase or 63-char id is returned unchanged", () => {
    assert.equal(containerHeading(null, HEX.toUpperCase()), HEX.toUpperCase());
    assert.equal(containerHeading(null, HEX.slice(1)), HEX.slice(1));
  });
  it("4: a name-style id is returned unchanged", () => {
    assert.equal(containerHeading(null, "jellyfin"), "jellyfin");
  });
});

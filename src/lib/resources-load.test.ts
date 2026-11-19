import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resourcesLoad } from "./resources-load.ts";

const snap = { containers: [] };

describe("resourcesLoad (/resources first load)", () => {
  it("1: no data and no error yet is loading", () => {
    assert.equal(resourcesLoad({ data: undefined, error: undefined }), "loading");
  });
  it("2: no data and an error is failed", () => {
    assert.equal(resourcesLoad({ data: undefined, error: new Error("500") }), "failed");
  });
  it("3: data and no error is ready", () => {
    assert.equal(resourcesLoad({ data: snap, error: undefined }), "ready");
  });
  it("4: kept data with a failing refresh stays ready", () => {
    assert.equal(resourcesLoad({ data: snap, error: new Error("500") }), "ready");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { labelUrlInvalid, pickOwn, widgetTarget } from "./target.ts";

describe("hunt 8 widget labels", () => {
  it("B1: inherited keys resolve to the fallback, own keys to themselves", () => {
    const table = { sonarr: "S", generic: "G" };
    for (const k of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      assert.equal(pickOwn(table, k, table.generic), "G", k);
    }
    assert.equal(pickOwn(table, "sonarr", table.generic), "S");
    assert.equal(pickOwn(table, "nope", table.generic), "G");
  });
  it("B7: a label widget needs an absolute http(s) URL", () => {
    const l = (endpoint?: string) => labelUrlInvalid({ id: "label:abc", endpoint });
    assert.equal(l("/status"), true);
    assert.equal(l("example.test/status"), true);
    assert.equal(l(undefined), true);
    assert.equal(l("https://example.test/status"), false);
    assert.equal(l("HTTP://example.test/status"), false);
  });
  it("B7: config widgets are never rejected, and widgetTarget is unchanged", () => {
    assert.equal(labelUrlInvalid({ id: "cfg1", endpoint: "/status" }), false);
    assert.equal(widgetTarget({ url: "http://x.test", endpoint: "/status" }), "http://x.test/status");
    assert.equal(widgetTarget({ url: "http://x.test" }), "http://x.test");
  });
});

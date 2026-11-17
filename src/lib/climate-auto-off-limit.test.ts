import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { allowAutoOffSave, resetAutoOffSaves } from "./climate-auto-off.ts";

describe("allowAutoOffSave", () => {
  beforeEach(resetAutoOffSaves);

  it("allows 10 saves in a minute, refuses the 11th, frees up after 60 s", () => {
    for (let i = 0; i < 10; i++) assert.equal(allowAutoOffSave(1000 + i), true);
    assert.equal(allowAutoOffSave(1500), false);
    assert.equal(allowAutoOffSave(1500), false);
    assert.equal(allowAutoOffSave(61_000), true); // first save (t=1000) has aged out
  });
});

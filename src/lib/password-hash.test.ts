import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { choosePasswordHashes } from "./password-hash.ts";

// Placeholders only: the chooser never parses a hash.
const STORED = "stored-hash-placeholder";
const ENV = "env-hash-placeholder";

describe("choosePasswordHashes (stored hash wins over env)", () => {
  it("stored and env set: stored only", () => {
    assert.deepEqual(choosePasswordHashes(STORED, ENV), [{ hash: STORED, source: "config" }]);
  });
  it("stored set, env unset: stored only", () => {
    assert.deepEqual(choosePasswordHashes(STORED, undefined), [{ hash: STORED, source: "config" }]);
  });
  for (const blank of [undefined, "", "   "]) {
    it(`stored ${JSON.stringify(blank)}, env set: env only`, () => {
      assert.deepEqual(choosePasswordHashes(blank, ` ${ENV} `), [{ hash: ENV, source: "env" }]);
    });
  }
  it("neither set: none", () => {
    assert.deepEqual(choosePasswordHashes(undefined, undefined), []);
    assert.deepEqual(choosePasswordHashes("  ", ""), []);
  });
  it("removing the stored hash puts env back (recovery)", () => {
    assert.equal(choosePasswordHashes(STORED, ENV)[0].hash, STORED);
    assert.equal(choosePasswordHashes(undefined, ENV)[0].hash, ENV);
  });
  it("auth-server.ts delegates to it and the docs state the rule", () => {
    assert.match(readFileSync(new URL("./auth-server.ts", import.meta.url), "utf8"), /choosePasswordHashes\(/);
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    assert.doesNotMatch(readme, /still accepts the old password/);
  });
});

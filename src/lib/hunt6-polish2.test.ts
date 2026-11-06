import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Source scans: these routes import the "@/" alias, which node:test cannot load (hunt 6 polish 2).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const catchOf = (src: string) => src.slice(src.indexOf("catch (e)"));

describe("hunt 6 polish 2: fixed error text", () => {
  it("openrouter-models never echoes e.message", () => {
    const c = catchOf(read("../app/api/hermes/openrouter-models/route.ts"));
    assert.ok(!c.includes("e.message"));
    assert.equal(c.split('detail: "openrouter unreachable"').length - 1, 2);
    assert.ok(c.includes('console.error("openrouter-models", e)'));
  });
  for (const dir of ["", "hermes-daemon/", "integrations/", "password/", "system/"]) {
    it(`settings/${dir}route save catch sends "save failed" only`, () => {
      const c = catchOf(read(`../app/api/settings/${dir}route.ts`));
      assert.ok(!c.includes("e.message"));
      assert.ok(c.includes('{ error: "save failed" }'));
      assert.ok(c.includes("console.error("));
    });
  }
  it("widgets/action keeps WidgetError text, hides the rest", () => {
    const c = catchOf(read("../app/api/widgets/action/route.ts"));
    assert.equal(c.split("e.message").length - 1, 1);
    assert.ok(c.includes("e instanceof WidgetError ? e.message"));
    assert.ok(c.includes('"action failed"'));
    assert.ok(c.includes('console.error("widgets/action", e)'));
  });
});

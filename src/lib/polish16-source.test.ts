/* Polish 16 (hunt 117): a long unbroken strip name and a long failure reason wrap inside their frame. Source pin: no browser. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const rule = (selector: string) => {
  const m = css.match(new RegExp(`^${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(m, `${selector} rule exists`);
  return m[1];
};

describe("polish 16: long text wraps inside its container", () => {
  it(".st-name wraps an unbroken name and may shrink in the grid column, without breaking at every letter", () => {
    const body = rule(".st-name");
    assert.match(body, /min-width:\s*0/);
    assert.match(body, /overflow-wrap:\s*anywhere/);
    assert.doesNotMatch(body, /word-break:\s*break-all/);
  });

  it(".st-say wraps a long failure reason inside the write frame, never truncating it", () => {
    const body = rule(".st-say");
    assert.match(body, /min-width:\s*0/);
    assert.match(body, /overflow-wrap:\s*anywhere/);
    assert.doesNotMatch(body, /text-overflow|line-clamp/);
  });
});

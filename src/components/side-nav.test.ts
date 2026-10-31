import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = readFileSync(new URL("./side-nav.tsx", import.meta.url), "utf8");

test("exactly one Orchestra entry, directly after Hermes, pointing at /orchestrators", () => {
  assert.equal(src.match(/label: "Orchestra"/g)?.length, 1);
  assert.match(
    src,
    /\{ href: "\/hermes", label: "Hermes", icon: Bot \},\s*\{ href: "\/orchestrators", label: "Orchestra", icon: Workflow \},/,
  );
});

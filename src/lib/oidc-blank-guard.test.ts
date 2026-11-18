import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// oidc.ts imports "@/..." aliases and jose, so node:test cannot load it here: pin the wiring by source instead.
describe("oidcAllowListCheck wiring", () => {
  const src = fs.readFileSync(new URL("./oidc.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export function oidcAllowListCheck"), src.indexOf("/** Host only"));
  it("imports configProblem and passes it to oidcAllowVerdict", () => {
    assert.match(src, /import \{[^}]*\bconfigProblem\b[^}]*\} from "@\/lib\/config"/);
    assert.match(fn, /oidcAllowVerdict\([^;]*console,\s*configProblem\(\),?\s*\)/s);
  });
});

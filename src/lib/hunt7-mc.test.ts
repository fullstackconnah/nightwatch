import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sanitizeSlug } from "./minecraft/slug.ts";

// Source scans: these routes and jellyfin.ts import the "@/" alias, which node:test cannot load (hunt 7 A4 A5 A6 A8).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("hunt 7 minecraft and jellyfin", () => {
  it("A4: sanitizeSlug matches the manager's slug rule", () => {
    assert.equal(sanitizeSlug("../Bad Slug"), "m---bad-slug");
    assert.equal(sanitizeSlug("ok-1"), "ok-1");
  });
  it("A4: upload forwards only the five fields, sanitised, with a timeout", () => {
    const s = read("../app/api/minecraft/instances/upload/route.ts");
    assert.ok(s.includes("sanitizeSlug("));
    assert.ok(!s.includes("params.toString()"));
    assert.ok(s.includes("AbortSignal.timeout(10 * 60 * 1000)"));
    assert.ok(s.includes("name.length > 100") && s.includes("mcVersion.length > 100"));
  });
  it("A5: restore refuses path-like instance and file", () => {
    const s = read("../app/api/minecraft/backups/route.ts");
    assert.ok(s.includes('includes("..")') && s.includes("<= 255"));
  });
  it("A6: numberOrNull treats null, undefined and blank as null", () => {
    const s = read("./jellyfin.ts");
    assert.ok(/function numberOrNull[^}]*value == null \|\| value === ""/s.test(s));
  });
  it("A8: rcon refuses a command over 1000 characters", () => {
    const s = read("../app/api/minecraft/rcon/route.ts");
    assert.ok(s.includes("command.length > 1000") && s.includes("command too long"));
  });
});

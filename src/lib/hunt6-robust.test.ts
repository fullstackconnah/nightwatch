import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Source scans: these modules import the "@/" alias, which node:test cannot load (hunt 6 A2 A3 B3 B8).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("hunt 6 robustness", () => {
  it("A2: tool lookup ignores inherited names", () => {
    assert.ok(read("./mcp/tools.ts").includes("Object.hasOwn(ACTION_BY_TOOL, name)"));
  });
  it("A3: a malformed logs URI is INVALID_PARAMS, not a URIError", () => {
    const src = read("./mcp/resources.ts");
    const at = src.indexOf("decodeURIComponent");
    assert.ok(/try\s*\{[^}]*$/.test(src.slice(Math.max(0, at - 80), at)));
    assert.ok(src.includes("catch"));
  });
  it("B3: repo bundle guards non-array bodies and non-string shas", () => {
    const fn = read("./forgejo.ts");
    const b = fn.slice(fn.indexOf("async function fetchRepoBundle"));
    assert.ok(b.includes("Array.isArray(commitsRes.data)"));
    assert.ok(b.includes("Array.isArray(branchesRes.data)"));
    assert.ok(b.includes("Array.isArray(pullsRes.data)"));
    assert.ok(b.includes("Array.isArray(mirrorsRes.data)"));
    assert.ok(b.includes('typeof c.sha === "string"'));
    assert.equal(b.split("&& typeof").length - 1, 4); // R1: null elements dropped from commits, branches, pulls, mirrors
  });
  it("B8: HA delta must be finite and bounded", () => {
    const src = read("../app/api/ha/action/route.ts");
    assert.ok(src.includes("Number.isFinite(v.delta)"));
    assert.ok(src.includes("Math.abs(v.delta) > 10"));
  });
});

describe("hunt 8 error text (A5 B4)", () => {
  const sites: [string, string][] = [
    ["./mcp/protocol.ts", "Internal error"],
    ["./mcp/tools.ts", "Failed to ${action}"],
    ["../app/api/widgets/route.ts", "Couldn't load widgets"],
    ["../app/api/telemetry/history/route.ts", "Couldn't read history"],
    ["../app/api/logs/stream/route.ts", "could not read scrollback`"],
  ];
  for (const [file, text] of sites) {
    it(`${file} sends fixed text, not the caught error`, () => {
      const src = read(file);
      assert.ok(src.includes(text), text);
      assert.ok(!/e instanceof Error \? e\.message/.test(src.slice(src.indexOf("catch"))) || file.includes("tools"), "raw e.message");
      assert.ok(!src.includes("scrollback: ${message}"));
      assert.ok(!src.includes("${message}\", true") && !src.includes("${message}`, true"));
      assert.ok(!/INTERNAL_ERROR, message/.test(src));
    });
  }
});

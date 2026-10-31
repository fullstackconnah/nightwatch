import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// resources.ts and tools.ts import via the "@/" alias, which node:test cannot load, so assert on source.
const resources = readFileSync(new URL("./resources.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("./tools.ts", import.meta.url), "utf8");

describe("MCP orchestra surface", () => {
  it("lists and reads the read-only nightwatch://orchestrators resource", () => {
    assert.match(resources, /const ORCHESTRATORS_URI = "nightwatch:\/\/orchestrators"/);
    assert.match(resources, /uri: ORCHESTRATORS_URI/);
    assert.match(resources, /uri === ORCHESTRATORS_URI/);
  });
  it("adds no tool", () => {
    assert.deepEqual(
      [...tools.matchAll(/^\s+name: "([^"]+)"/gm)].map((m) => m[1]),
      ["container_start", "container_stop", "container_restart"],
    );
  });
  it("never reads the token", () => {
    assert.ok(!/orchestraToken|ORCHESTRA_TOKEN/.test(resources));
  });
});

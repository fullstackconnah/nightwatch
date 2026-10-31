import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// resources.ts and tools.ts import via the "@/" alias, which node:test cannot load, so assert on source.
// The orchestra data is deliberately NOT on MCP: /api/mcp is reachable with the public bearer.
const resources = readFileSync(new URL("./resources.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("./tools.ts", import.meta.url), "utf8");

describe("MCP surface is unchanged by the orchestra proxy", () => {
  it("resource list is exactly the existing ones", () => {
    assert.deepEqual(
      [...resources.matchAll(/^const \w+_URI = "([^"]+)"/gm)].map((m) => m[1]),
      ["nightwatch://containers", "nightwatch://telemetry", "nightwatch://smart"],
    );
    assert.ok(!/orchestra/i.test(resources));
  });
  it("tool list is exactly the existing ones", () => {
    assert.deepEqual(
      [...tools.matchAll(/^\s+name: "([^"]+)"/gm)].map((m) => m[1]),
      ["container_start", "container_stop", "container_restart"],
    );
    assert.ok(!/orchestra/i.test(tools));
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("docker action route", () => {
  it("logs an unmapped docker error", () => {
    const src = readFileSync(new URL("../app/api/docker/containers/[id]/action/route.ts", import.meta.url), "utf8");
    assert.match(src, /console\.error\("docker action failed", id, action, e\)/);
  });
});

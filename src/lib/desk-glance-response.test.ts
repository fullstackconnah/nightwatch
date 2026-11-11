import { test } from "node:test";
import assert from "node:assert/strict";
import { deskGlanceResponse } from "./desk-glance-response.ts";

const TOKEN = "d".repeat(40);
const MCP = "m".repeat(40);

function run(over: { deskToken?: string; authorization: string | null }) {
  let built = 0;
  const p = deskGlanceResponse({
    deskToken: "deskToken" in over ? over.deskToken : TOKEN,
    mcpToken: MCP,
    authorization: over.authorization,
    build: async () => ({ built: ++built }),
  });
  return { p, built: () => built };
}

test("desk off answers 503 and builds nothing", async () => {
  for (const deskToken of [undefined, "short", MCP]) {
    const r = run({ deskToken, authorization: `Bearer ${TOKEN}` });
    assert.deepEqual(await r.p, { status: 503, body: { error: "Desk access is not turned on." } });
    assert.equal(r.built(), 0);
  }
});

test("a missing or bad bearer answers 401 and the report builder is never called", async () => {
  for (const authorization of [null, "", "Bearer nope", `Bearer ${"x".repeat(40)}`, TOKEN]) {
    const r = run({ authorization });
    assert.deepEqual(await r.p, { status: 401, body: { error: "unauthorized" } });
    assert.equal(r.built(), 0);
  }
});

test("a good bearer answers 200 with the built glance", async () => {
  const r = run({ authorization: `Bearer ${TOKEN}` });
  assert.deepEqual(await r.p, { status: 200, body: { built: 1 } });
  assert.equal(r.built(), 1);
});

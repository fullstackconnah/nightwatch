import test from "node:test";
import assert from "node:assert/strict";
import { mcSecretFlags } from "./mc-secret-flags.ts";

test("flags are booleans per secret, never the value", () => {
  const f = mcSecretFlags({ managerToken: "t", curseforgeKey: "", rconPassword: "pw" });
  assert.deepEqual(f, { managerTokenSet: true, curseforgeKeySet: false, rconPasswordSet: true });
  assert.equal(JSON.stringify(f).includes("pw"), false);
});
test("missing block is all false", () => {
  assert.deepEqual(mcSecretFlags(undefined), { managerTokenSet: false, curseforgeKeySet: false, rconPasswordSet: false });
});

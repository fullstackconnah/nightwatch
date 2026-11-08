import assert from "node:assert/strict";
import { test } from "node:test";
import { createErrorCopy } from "./docker-create-error.ts";

test("H17BF F3: create errors are fixed copy chosen by pattern", () => {
  const cases: [string, RegExp][] = [
    ["Bind for 0.0.0.0:8080 failed: port is already allocated", /^That host port is already in use\./],
    ["listen tcp 0.0.0.0:80: bind: address already in use", /^That host port is already in use\./],
    ['Conflict. The container name "/web" is already in use by container "abc"', /^A container with that name already exists\./],
    ["invalid mount config: bind source path does not exist: /srv/x", /^A bind source doesn't exist/],
    ["boom /srv/secret 10.0.0.1", /^Docker failed to create it\.$/],
  ];
  for (const [msg, want] of cases) {
    const out = createErrorCopy(msg);
    assert.match(out, want, msg);
    assert.ok(!out.includes(msg) && !/10\.0\.0\.1|\/srv|abc|8080/.test(out), `echoes: ${msg}`);
  }
});

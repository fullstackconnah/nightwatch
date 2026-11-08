import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const client = read("./client.ts");
const logs = read("./use-log-stream.ts");
const console_ = read("../components/logs/log-console.tsx");

test("both stream hooks reopen after the browser closes the EventSource", () => {
  for (const src of [client, logs]) {
    assert.match(src, /^.*EventSource\.CLOSED.*$/m);
    assert.match(src, /^.*afterClosedProbe\(.*$/m);
  }
});

test("log console no longer claims EventSource retries forever", () => {
  assert.doesNotMatch(console_, /retries forever/m);
});

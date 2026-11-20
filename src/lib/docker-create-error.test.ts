import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createErrorCopy, startOrRemove } from "./docker-create-error.ts";

test("H17BF F3: create errors are fixed copy chosen by pattern", () => {
  const cases: [string, RegExp][] = [
    ["Bind for 0.0.0.0:8080 failed: port is already allocated", /^That host port is already in use\./],
    ["listen tcp 0.0.0.0:80: bind: address already in use", /^That host port is already in use\./],
    ['Conflict. The container name "/web" is already in use by container "abc"', /^A container with that name already exists\./],
    ["invalid mount config: bind source path does not exist: /srv/x", /^A bind source doesn't exist/],
    ["boom /srv/secret 10.0.0.1", /^Docker failed to create it\.$/],
    ["Image pull stalled: no progress for 60s", /^The image pull stalled with no progress/],
    ["This operation was aborted", /^Docker did not answer within 10 seconds. Check that Docker is running, then try again.$/],
    ["The operation was aborted due to timeout", /^Docker did not answer within 10 seconds. Check that Docker is running, then try again.$/],
  ];
  for (const [msg, want] of cases) {
    const out = createErrorCopy(msg);
    assert.match(out, want, msg);
    assert.ok(!out.includes(msg) && !/10\.0\.0\.1|\/srv|abc|8080/.test(out), `echoes: ${msg}`);
  }
});

type Opts = Record<string, unknown>;
const fake = (startErr?: unknown, removeErr?: unknown) => {
  const removes: Opts[] = [];
  return {
    removes,
    start: async () => { if (startErr) throw startErr; },
    remove: async (o: Opts) => { removes.push(o); if (removeErr) throw removeErr; },
  };
};

test("hunt 100: a successful start removes nothing", async () => {
  const c = fake();
  await startOrRemove(c, 1000);
  assert.equal(c.removes.length, 0);
});

test("hunt 100: a failed start force-removes the created container (no volumes) and rethrows the same error", async () => {
  const E = new Error("Bind for 0.0.0.0:8080 failed: port is already allocated");
  const c = fake(E);
  let caught: unknown;
  await startOrRemove(c, 1000).catch((e) => { caught = e; });
  assert.equal(caught, E);
  assert.equal(c.removes.length, 1);
  assert.equal(c.removes[0].force, true);
  assert.ok(!("v" in c.removes[0]));
});

test("hunt 100: a failing remove does not mask the start error", async () => {
  const E = new Error("start failed");
  let caught: unknown;
  const calls: string[] = [];
  const orig = console.warn;
  console.warn = (m: unknown) => void calls.push(String(m));
  try {
    await startOrRemove(fake(E, new Error("remove failed")), 1000).catch((e) => { caught = e; });
  } finally {
    console.warn = orig;
  }
  assert.equal(caught, E);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /could not be removed after a failed start: remove failed/);
});

test("a successful remove after a failed start logs nothing", async () => {
  const calls: string[] = [];
  const orig = console.warn;
  console.warn = (m: unknown) => void calls.push(String(m));
  try {
    await startOrRemove(fake(new Error("start failed")), 1000).catch(() => {});
  } finally {
    console.warn = orig;
  }
  assert.equal(calls.length, 0);
});

test("hunt 100: createAndStartContainer uses the helper, not a bare start", () => {
  const src = readFileSync(new URL("./docker.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function createAndStartContainer"), src.indexOf("export async function refuseCreate"));
  assert.match(body, /startOrRemove\(container, DOCKER_CALL_MS\)/);
  assert.ok(!/await container\.start\(/.test(body));
});

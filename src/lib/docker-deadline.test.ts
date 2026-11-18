import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { ACTION_TIMEOUT_MESSAGE, REMOVE_TIMEOUT_MESSAGE, isDeadlineError } from "./docker-deadline.ts";
import { removeErrorCopy } from "./container-remove.ts";

const Docker = createRequire(import.meta.url)("dockerode");
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("copy is the exact sentence for action and removal", () => {
  assert.equal(ACTION_TIMEOUT_MESSAGE, "Docker didn't answer in time. The action may still have gone through, so check the container before trying again.");
  assert.equal(REMOVE_TIMEOUT_MESSAGE, "Docker didn't answer in time. The removal may still have gone through, so check the container before trying again.");
  assert.equal(removeErrorCopy("TIMEOUT", "web"), REMOVE_TIMEOUT_MESSAGE);
});

test("the real abort error from a proxy that never answers is recognised; other errors are not", { timeout: 5000 }, async () => {
  const server = createServer(() => {}); // accepts the request, never answers
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const docker = new Docker({ host: "127.0.0.1", port: (server.address() as { port: number }).port, protocol: "http" });
  try {
    for (const verb of ["start", "stop", "restart", "pause", "unpause", "remove"]) {
      const err = await docker.getContainer("x")[verb]({ abortSignal: AbortSignal.timeout(150) }).then(() => null, (e: unknown) => e);
      assert.ok(isDeadlineError(err), verb);
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
  for (const e of [{ statusCode: 404 }, new Error("ECONNRESET"), null, undefined]) assert.equal(isDeadlineError(e), false);
});

test("every lifecycle verb and remove carry the action deadline", () => {
  const s = src("./docker.ts");
  assert.match(s, /const DOCKER_ACTION_MS = 45_000;/);
  const body = s.slice(s.indexOf("export async function containerAction"), s.indexOf("export async function performContainerAction"));
  for (const verb of ["start", "stop", "restart", "pause", "unpause"]) {
    assert.match(body, new RegExp(String.raw`container\.${verb}\(\{[^}]*abortSignal: AbortSignal\.timeout\(DOCKER_ACTION_MS\)`), verb);
  }
  assert.match(body, /stop\(\{ t: 15,/);
  assert.match(body, /restart\(\{ t: 15,/);
  assert.match(s, /remove\(\{ \.\.\.REMOVE_OPTIONS, abortSignal: AbortSignal\.timeout\(DOCKER_ACTION_MS\) \}\)/);
});

test("the action route answers 504 with the timeout copy and still releases the guard", () => {
  const s = src("../app/api/docker/containers/[id]/action/route.ts");
  assert.match(s, /if \(isDeadlineError\(e\)\) return ACTION_TIMEOUT_MESSAGE;/);
  assert.match(s, /isDeadlineError\(e\) \? 504 : status === 404/);
  assert.match(s, /\} finally \{\s*release\(\);/);
  // existing copy untouched
  assert.match(s, /That container no longer exists\./);
  assert.match(s, /Docker failed to \$\{action\} it\./);
});

test("the remove route answers 504 with the removal copy", () => {
  const s = src("../app/api/docker/containers/[id]/route.ts");
  assert.match(s, /isDeadlineError\(e\)\) \{\s*return NextResponse\.json\(\{ error: removeErrorCopy\("TIMEOUT", target\.name\) \}, \{ status: 504 \}\)/);
});

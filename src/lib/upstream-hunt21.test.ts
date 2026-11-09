import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const docker = src("./docker.ts");
const logStream = src("./log-stream.ts");
const oidc = src("./oidc.ts");
const client = src("./integration-client.ts");
const widgetTypes = src("./widgets/types.ts");
const npm = src("./npm.ts");
const voice = src("./voice.ts");

test("H21U F1: one-shot docker calls carry a deadline, the pull an idle guard", () => {
  assert.match(docker, /^\s+const raw = await docker\.listContainers\(\{ all: true, abortSignal: AbortSignal\.timeout\(DOCKER_CALL_MS\) \}\);/m);
  assert.match(docker, /^\s+const info = await docker\.getContainer\(id\)\.inspect\(\{ abortSignal: AbortSignal\.timeout\(DOCKER_CALL_MS\) \}\);/m);
  assert.match(docker, /^\s+abortSignal: AbortSignal\.timeout\(DOCKER_LOGS_MS\),/m);
  assert.match(docker, /^\s+abortSignal: AbortSignal\.timeout\(DOCKER_CALL_MS\),\s*$/m);
  assert.match(docker, /^\s+await container\.start\(\{ abortSignal: AbortSignal\.timeout\(DOCKER_CALL_MS\) \} as never\);/m);
  assert.match(docker, /^\s+const stop = guardPullIdle\(/m);
  assert.doesNotMatch(docker, /new Docker\(\{[^}]*timeout/s);
});

test("H21U F2: log resume read is capped with the seed cap", () => {
  assert.match(logStream, /^\s+\.\.\.\(sinceMs === undefined \? \{ tail \} : \{ since: Math\.floor\(sinceMs \/ 1000\), tail: LOG_TAIL_MAX \}\),/m);
});

test("H21U F3: oidc bodies are deadline-covered and capped", () => {
  assert.doesNotMatch(oidc, /fetchWithTimeout/);
  assert.equal((oidc.match(/^\s+signal: AbortSignal\.timeout\(HTTP_TIMEOUT_MS\)/gm) ?? []).length, 2);
  assert.equal((oidc.match(/readJsonCapped</g) ?? []).length, 2);
  assert.doesNotMatch(oidc, /await res\.json\(\)/);
});

test("H21U F4: integration and widget helpers read capped", () => {
  assert.match(client, /^\s+body = await readJsonCapped\(res, /m);
  assert.doesNotMatch(client, /await res\.json\(\)/);
  assert.match(widgetTypes, /^\s+return await readJsonCapped<T>\(res, /m);
  assert.doesNotMatch(widgetTypes, /await res\.json\(\)/);
});

test("H21U F5/F6: npm detail has no url, probe cancels its body", () => {
  assert.doesNotMatch(npm, /for \$\{url\}/);
  assert.match(npm, /^\s+r\.body\?\.cancel\(\)\.catch\(\(\) => \{\}\);/m);
});

test("H21U F7: voice keeps the upstream body server-side", () => {
  assert.equal((voice.match(/detail: `Voice server returned HTTP \$\{res\.status\}\.`/g) ?? []).length, 2);
  assert.doesNotMatch(voice, /\.slice\(0, 200\)/);
  assert.match(voice, /console\.error\(`\[voice\]/);
});

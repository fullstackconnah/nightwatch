import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REMOVE_OPTIONS,
  PROTECTED_REMOVE_MESSAGE,
  removeConfirmText,
  removeDecision,
  removeErrorCopy,
} from "./container-remove.ts";

const c = (o: Record<string, unknown> = {}) => ({
  id: "a".repeat(64), name: "web", image: "nginx", state: "exited", composeProject: null, composeService: null, ...o,
});
const decide = (list: ReturnType<typeof c>[] | null, id = "web", host = "") => removeDecision(list, id, host);

test("created and exited are removable", () => {
  for (const state of ["created", "exited"]) assert.equal("ok" in decide([c({ state })]), true, state);
});

test("any other state is a 409 naming the state", () => {
  for (const state of ["running", "paused", "restarting", "dead", "removing"]) {
    const r = decide([c({ state })]);
    assert.ok("status" in r && r.status === 409, state);
    assert.equal(r.message, `web isn't stopped (${state}), so it wasn't removed. Stop it in Resources first.`);
  }
});

test("protected kinds are 403, even when exited", () => {
  const host = "abcdef123456";
  const kinds = [
    c({ name: "homelab-dashboard" }),
    c({ name: "homelab-dashboard-test" }),
    c({ name: "homelab-dashboard-proxy" }),
    c({ image: "tecnativa/docker-socket-proxy" }),
    c({ name: "dockge" }),
    c({ id: host + "0".repeat(52) }),
  ];
  for (const k of kinds) {
    const r = decide([k], k.name, host);
    assert.ok("status" in r && r.status === 403, k.name + k.image);
    assert.equal(r.message, PROTECTED_REMOVE_MESSAGE);
  }
});

test("unknown id is 404, null list is 503", () => {
  const nf = decide([c()], "nope");
  assert.ok("status" in nf && nf.status === 404);
  const nl = decide(null);
  assert.ok("status" in nl && nl.status === 503);
});

test("ok returns the target", () => {
  const r = decide([c()], "aaaa");
  assert.ok("ok" in r && r.target.name === "web");
});

test("remove never forces and never drops volumes", () => {
  assert.deepEqual(REMOVE_OPTIONS, { force: false, v: false });
  for (const f of ["src/lib/docker.ts", "src/app/api/docker/containers/[id]/route.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /force:\s*true/, f);
    assert.doesNotMatch(src, /\bv:\s*true/, f);
  }
});

test("DELETE decides before removing, from a fresh read", () => {
  const src = readFileSync("src/app/api/docker/containers/[id]/route.ts", "utf8");
  const del = src.slice(src.indexOf("export async function DELETE"));
  assert.match(del, /listContainers\(true\)/);
  assert.ok(del.indexOf("removeDecision(") > -1 && del.indexOf("removeDecision(") < del.indexOf("removeContainer("));
});

test("confirm text", () => {
  assert.equal(removeConfirmText("web"), "Remove web? Its image can then be deleted. Can't be undone.");
});

test("error copy per failure, the two 403s differ", () => {
  assert.match(removeErrorCopy(403, "web"), /POST=1 and CONTAINERS=1/);
  assert.notEqual(removeErrorCopy(403, "web"), PROTECTED_REMOVE_MESSAGE);
  assert.equal(removeErrorCopy(404, "web"), "That container no longer exists.");
  assert.equal(removeErrorCopy(409, "web"), "web is running again, so it wasn't removed. Stop it in Resources first.");
  assert.match(removeErrorCopy("ECONN", "web"), /Can't reach the Docker socket proxy/);
});

test("an id prefix shared by two containers is a 404, not the first match", () => {
  const list = [c({ id: "ab1" + "0".repeat(61), name: "one" }), c({ id: "ab2" + "0".repeat(61), name: "two" })];
  const r = decide(list, "ab");
  assert.ok("status" in r && r.status === 404);
  assert.ok("ok" in decide(list, "ab1"), "a unique prefix still resolves");
  assert.ok("ok" in decide(list, "two"), "an exact name still resolves");
});

test("protection beats state: running dockge is 403, not 409", () => {
  const r = decide([c({ name: "dockge", state: "running" })], "dockge");
  assert.ok("status" in r && r.status === 403);
});

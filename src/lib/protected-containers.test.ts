import { test } from "node:test";
import assert from "node:assert/strict";
import { isProtectedContainer, UI_BLOCKED_ACTIONS, MCP_ALLOWED_ON_PROTECTED } from "./protected-containers.ts";

const c = (o: Partial<Parameters<typeof isProtectedContainer>[0]>) => ({
  id: "a".repeat(64), name: "plex", image: "plexinc/pms-docker", composeProject: null, composeService: null, ...o,
});

test("own containers by compose name", () => {
  for (const name of ["homelab-dashboard", "homelab-dashboard-proxy", "homelab-dashboard-test", "homelab-dashboard-test-proxy"]) {
    assert.equal(isProtectedContainer(c({ name })), true, name);
  }
});
test("self by hostname id prefix", () => {
  assert.equal(isProtectedContainer(c({ id: "abcdef123456" + "0".repeat(52) }), "abcdef123456"), true);
  assert.equal(isProtectedContainer(c({}), "abcdef123456"), false);
  assert.equal(isProtectedContainer(c({}), "short"), false);
  assert.equal(isProtectedContainer(c({ id: "short1" }), "short1"), false);
});
test("socket proxy by image", () => {
  assert.equal(isProtectedContainer(c({ name: "x", image: "tecnativa/docker-socket-proxy:latest" })), true);
});
test("dockge by name, image, project or service", () => {
  assert.equal(isProtectedContainer(c({ name: "dockge" })), true);
  assert.equal(isProtectedContainer(c({ name: "x", image: "louislam/dockge:1" })), true);
  assert.equal(isProtectedContainer(c({ name: "x", composeProject: "dockge" })), true);
  assert.equal(isProtectedContainer(c({ name: "x", composeService: "Dockge" })), true);
});
test("ordinary and empty containers are not protected", () => {
  assert.equal(isProtectedContainer(c({})), false);
  assert.equal(isProtectedContainer(c({ name: "homelab-dashboard-other" })), false);
  assert.equal(isProtectedContainer(c({ id: "", name: "", image: "" })), false);
});
test("ui blocks stop and pause, not restart", () => {
  assert.deepEqual([...UI_BLOCKED_ACTIONS], ["stop", "pause"]);
});
test("mcp may only start a protected container", () => {
  assert.deepEqual([...MCP_ALLOWED_ON_PROTECTED], ["start"]);
});

import { findTarget } from "./protected-containers.ts";
test("findTarget: 12-char prefix, exact name, name beats earlier hex-prefix id, unknown", () => {
  const a = c({ id: "abcdef123456" + "0".repeat(52), name: "plex" });
  const hexName = c({ id: "f".repeat(64), name: "abcdef123456" });
  assert.equal(findTarget([a, hexName], "abcdef123456".slice(0, 12)), hexName);
  assert.equal(findTarget([a], "abcdef123456"), a);
  assert.equal(findTarget([a], "plex"), a);
  assert.equal(findTarget([a], "nope"), undefined);
});

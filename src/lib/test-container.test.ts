import { test } from "node:test";
import assert from "node:assert/strict";
import { isTestContainer } from "./test-container.ts";

const t = (name: string, composeProject: string | null = null) => isTestContainer({ name, composeProject });

test("test containers match by name or compose project token", () => {
  assert.ok(t("homelab-dashboard-test", "homelab-dashboard-test"));
  assert.ok(t("homelab-dashboard-test-proxy", "homelab-dashboard-test"));
  assert.ok(t("homelab-dashboard-test-media-worker", "homelab-dashboard-test"));
  assert.ok(t("homelab-dashboard-test-orchestra-mock", "homelab-dashboard-test"));
  assert.ok(t("web-1", "homelab-dashboard-test"));
  assert.ok(t("vvtest-ship-152-ui-20261116-144453-471e"));
  assert.ok(t("odip-pgtest-15432"));
  assert.ok(t("odip_test_db"));
  assert.ok(t("a.test.b"));
});

test("docker random names with no compose project match", () => {
  assert.ok(t("hungry_leavitt"));
  assert.ok(!t("hungry_leavitt", "someproject"));
});

test("real services do not match", () => {
  for (const n of ["jellyfin", "homeassistant", "odip-api", "vaultview", "minecraft", "pihole", "latest-app", "contest", "attestation", "odip-b3-pg"]) {
    assert.ok(!t(n), n);
  }
  assert.ok(!t("immich_server", "immich"));
  assert.ok(!t("odip-api", "odip"));
});

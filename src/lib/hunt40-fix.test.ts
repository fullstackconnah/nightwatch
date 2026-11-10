import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ApiError } from "./api-error.ts";
import { RESTORE_STILL_RUNNING, restoreSoftFailure } from "./restore-failure.ts";
import { dashVersions, checkBaseVersion } from "./settings/dash-version.ts";
import type { AppConfig } from "./config.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("H40-F2: only a gateway timeout is a soft restore failure", () => {
  for (const s of [504, 524]) assert.equal(restoreSoftFailure(new ApiError(`HTTP ${s}`, s)), RESTORE_STILL_RUNNING);
  for (const s of [502, 500]) assert.equal(restoreSoftFailure(new ApiError(`HTTP ${s}`, s)), null);
  assert.equal(restoreSoftFailure(new TypeError("Failed to fetch")), null);
});

test("H40-F2: the restore branch answers 504 when the manager call timed out", () => {
  const src = read("../app/api/minecraft/backups/route.ts");
  const restore = src.slice(src.indexOf('action === "restore" && isRestoreBody'));
  assert.match(restore, /^\s+const \{ status, error \} = probe\.timedOut \? \{ status: 504, error: probeErrorResponse\(probe\)\.error \} : probeErrorResponse\(probe\);$/m);
  assert.doesNotMatch(src.slice(0, src.indexOf('action === "restore" && isRestoreBody')), /504/);
});

test("H40-F1: persist refreshes after a 409 and rethrows", () => {
  const src = read("../app/(dash)/settings/page.tsx");
  assert.match(
    src,
    /^\s+\} catch \(e\) \{\r?\n\s+if \(e instanceof ApiError && e\.status === 409\) await mutate\(\);\r?\n\s+throw e;\r?\n\s+\}\r?$/m,
  );
});

const cfg = (widgets: unknown[]) => ({ groups: [], urls: {}, icons: {}, hidden: [], widgets }) as unknown as AppConfig;
const w = (over: Record<string, unknown> = {}) => ({ id: "w1", type: "t", name: "N", url: "http://x", ...over });

test("H40-F3: widget secrets don't move the widgets tag, a visible change does", () => {
  const base = dashVersions(cfg([w({ key: "k1", password: "p1", headers: { A: "v1" } })]));
  assert.equal(base.widgets, dashVersions(cfg([w({ key: "k2", password: "p2", headers: { A: "v2" } })])).widgets);
  assert.notEqual(base.widgets, dashVersions(cfg([w({ name: "Other", key: "k1", password: "p1", headers: { A: "v1" } })])).widgets);
  assert.notEqual(dashVersions(cfg([w()])).widgets, dashVersions(cfg([w({ key: "k" })])).widgets);
  // H40R-3: the passwordSet flip and a header-name change are visible, so they move the tag
  assert.notEqual(dashVersions(cfg([w()])).widgets, dashVersions(cfg([w({ password: "p" })])).widgets);
  assert.notEqual(dashVersions(cfg([w({ headers: { A: "" } })])).widgets, dashVersions(cfg([w({ headers: { B: "" } })])).widgets);
});

test("H40-F3: the tiles tag ignores widgets and checkBaseVersion still gates widget saves", () => {
  const a = cfg([w({ key: "k1" })]);
  assert.equal(dashVersions(a).tiles, dashVersions(cfg([])).tiles);
  const v = dashVersions(a).widgets;
  assert.equal(checkBaseVersion(a, { widgets: [], baseVersion: v }), null);
  assert.equal(checkBaseVersion(cfg([w({ name: "Changed" })]), { widgets: [], baseVersion: v })?.status, 409);
});

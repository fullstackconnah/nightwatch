import test from "node:test";
import assert from "node:assert/strict";
import { dashVersions, checkBaseVersion } from "./dash-version.ts";
import type { AppConfig } from "../config.ts";

const cfg = (over: Record<string, unknown> = {}) =>
  ({ groups: [{ id: "g" }], urls: { a: "http://x" }, icons: {}, hidden: [], widgets: [{ id: "w" }], ...over }) as unknown as AppConfig;

test("versions are stable for equal content and change on any edit", () => {
  const a = dashVersions(cfg());
  assert.deepEqual(a, dashVersions(cfg()));
  assert.notEqual(a.tiles, dashVersions(cfg({ hidden: ["x"] })).tiles);
  assert.notEqual(a.widgets, dashVersions(cfg({ widgets: [] })).widgets);
  assert.equal(a.tiles, dashVersions(cfg({ widgets: [] })).tiles);
});

test("missing baseVersion is accepted (tab from before the check)", () => {
  assert.equal(checkBaseVersion(cfg(), { widgets: [] }), null);
});

test("matching baseVersion is accepted, mismatch is a 409 with the reload text", () => {
  const v = dashVersions(cfg());
  assert.equal(checkBaseVersion(cfg(), { widgets: [], baseVersion: v.widgets }), null);
  assert.equal(checkBaseVersion(cfg(), { groups: [], urls: {}, icons: {}, hidden: [], baseVersion: v.tiles }), null);
  const r = checkBaseVersion(cfg({ widgets: [{ id: "other" }] }), { widgets: [], baseVersion: v.widgets });
  assert.equal(r?.status, 409);
  assert.equal(r?.error, "The dashboard was changed in another tab or device. Reload to get the latest, then make your change again.");
});

test("a non-string or over-long baseVersion is a 400", () => {
  assert.equal(checkBaseVersion(cfg(), { widgets: [], baseVersion: 5 })?.status, 400);
  assert.equal(checkBaseVersion(cfg(), { widgets: [], baseVersion: null })?.status, 400);
  assert.equal(checkBaseVersion(cfg(), { widgets: [], baseVersion: "x".repeat(129) })?.status, 400);
});

test("the route checks before mergeDashPut and returns the new versions", () => {
  const s = readFileSync(fileURLToPath(new URL("../../app/api/settings/route.ts", import.meta.url)), "utf8");
  const check = s.indexOf("checkBaseVersion(current, body)");
  assert.ok(check > 0 && check < s.indexOf("mergeDashPut(current, body)"));
  assert.match(s, /^\s+return NextResponse\.json\(\{ ok: true, config: sanitizeConfig\(merged\.next\), versions: dashVersions\(merged\.next\) \}\);/m);
  assert.match(s, /^\s+versions: dashVersions\(config\),/m);
});
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

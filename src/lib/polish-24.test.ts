import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

test("installAndActivate refreshes the instances right after the create POST, before the activate POST", () => {
  const s = src("components/minecraft/pack-browser.tsx");
  const start = s.indexOf("async function installAndActivate");
  const body = s.slice(start, s.indexOf("async function activate(", start));
  const create = body.indexOf('postJson("/api/minecraft/instances"');
  const refresh = body.indexOf("onChanged()", create);
  const activate = body.indexOf("/activate`");
  assert.ok(create > 0 && refresh > create && refresh < activate, "onChanged() must sit between the create and activate POSTs");
});

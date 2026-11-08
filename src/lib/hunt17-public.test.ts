import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createStreamSlots } from "./stream-slots.ts";
import { autoOffUnchanged } from "./climate-auto-off.ts";

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../app/${p}`, import.meta.url)), "utf8");

test("login treats a non-string password like a missing one", () => {
  assert.match(src("api/auth/login/route.ts"), /^\s+if \(candidates\.length && typeof password === "string" && password\) \{$/m);
});

test("stream slots: acquire up to the cap, release once, never negative", () => {
  const s = createStreamSlots(3);
  const r = [s.acquire(), s.acquire(), s.acquire()];
  assert.equal(s.acquire(), null);
  assert.equal(s.open(), 3);
  r[0]!();
  r[0]!(); // double release is safe
  assert.equal(s.open(), 2);
  assert.ok(s.acquire());
  r[1]!();
  r[2]!();
  s.acquire()!();
  assert.ok(s.open() >= 0);
});

test("camera route caps open streams and releases on abort, end and error", () => {
  const route = src("kiosk/api/doorbell/camera/route.ts");
  assert.match(route, /^\s+const release = mode === "stream" \? slots\.acquire\(\) : undefined;$/m);
  assert.match(route, /^\s+if \(mode === "stream" && !release\)/m);
  assert.match(route, /status: 429/);
  assert.match(route, /^\s+req\.signal\.addEventListener\("abort", release/m);
});

test("auto-off skips a save that changes nothing", () => {
  const a = { enabled: true, time: "23:00", skipDate: "2030-01-01", lastRunDate: undefined };
  assert.equal(autoOffUnchanged({ ...a }, { ...a }), true);
  assert.equal(autoOffUnchanged(undefined, { enabled: false, time: "23:00", skipDate: undefined, lastRunDate: undefined }), false);
  assert.equal(autoOffUnchanged(a, { ...a, time: "22:00" }), false);
  assert.equal(autoOffUnchanged(a, { ...a, skipDate: undefined }), false);
  assert.equal(autoOffUnchanged(a, { ...a, lastRunDate: "2030-01-02" }), false);
  assert.equal(autoOffUnchanged(a, { ...a, enabled: false }), false);
});

test("auto-off route skips saveConfig through the helper", () => {
  assert.match(src("kiosk/api/climate-auto-off/route.ts"), /^\s+if \(!autoOffUnchanged\(prev, next\)\) saveConfig/m);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { heldCameraId } from "./doorbell-held-camera.ts";

test("a current camera always wins", () => {
  assert.equal(heldCameraId("camera.a", "camera.b", true), "camera.a");
  assert.equal(heldCameraId("camera.a", null, false), "camera.a");
});

test("a dropped camera list keeps the last camera while open", () => {
  assert.equal(heldCameraId(null, "camera.a", true), "camera.a");
});

test("nothing is held once closed or when there was no last camera", () => {
  assert.equal(heldCameraId(null, "camera.a", false), null);
  assert.equal(heldCameraId(null, null, true), null);
});

test("a new current camera replaces the last one", () => {
  assert.equal(heldCameraId("camera.c", "camera.a", true), "camera.c");
});

test("the hook returns the held value", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/kiosk/kiosk-doorbell.tsx", import.meta.url)), "utf8");
  assert.match(src, /cameraId:\s*heldCameraId\(|const held\w*\s*=\s*heldCameraId\(/);
  assert.match(src, /return \{[^}]*\bcameraId\b[^}]*\}/);
});

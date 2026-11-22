import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { heldCameraId, heldCameraName } from "./doorbell-held-camera.ts";

test("heldCameraName: the current name wins", () => {
  assert.equal(heldCameraName("Front", { id: "camera.a", name: "Old" }, "camera.a"), "Front");
});

test("heldCameraName: a dropped list keeps the last name for the same camera", () => {
  assert.equal(heldCameraName(undefined, { id: "camera.a", name: "Front" }, "camera.a"), "Front");
});

test("heldCameraName: a name held for another camera is never shown", () => {
  assert.equal(heldCameraName(undefined, { id: "camera.b", name: "Back" }, "camera.a"), "camera.a");
});

test("heldCameraName: no last name falls back to the id", () => {
  assert.equal(heldCameraName(undefined, null, "camera.a"), "camera.a");
});

test("the modal labels through heldCameraName, not the raw id", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/kiosk/kiosk-doorbell.tsx", import.meta.url)), "utf8");
  assert.match(src, /heldCameraName\(/);
  assert.doesNotMatch(src, /current\?\.name \?\? selected/);
});

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

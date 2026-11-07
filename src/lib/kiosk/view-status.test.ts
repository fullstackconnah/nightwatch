import assert from "node:assert/strict";
import { it } from "node:test";
import { cameraStatus, weatherViewStatus } from "./view-status.ts";

const base = { hasData: true, payload: "ok" as const, hasError: false, isLoading: false, hasLastOk: false };

it("weather: data and no error is ready", () => {
  assert.equal(weatherViewStatus(base), "ready");
});
it("weather: data and a failed revalidation is ready-stale", () => {
  assert.equal(weatherViewStatus({ ...base, hasError: true }), "ready-stale");
});
it("weather: no data keeps today's behaviour", () => {
  const none = { ...base, hasData: false, payload: undefined, hasError: true };
  assert.equal(weatherViewStatus({ ...none, isLoading: true }), "loading");
  assert.equal(weatherViewStatus({ ...none, hasLastOk: true }), "ready-stale");
  assert.equal(weatherViewStatus(none), "unreachable-empty");
});
it("weather: the payload's own flags keep today's behaviour", () => {
  assert.equal(weatherViewStatus({ ...base, payload: "unconfigured" }), "unconfigured");
  assert.equal(weatherViewStatus({ ...base, payload: "unreachable", hasLastOk: true }), "ready-stale");
  assert.equal(weatherViewStatus({ ...base, payload: "unreachable" }), "unreachable-empty");
});

it("camera: a failed probe shows Offline even after a good frame", () => {
  assert.equal(cameraStatus("snapshot", true, true), "failed");
});
it("camera: painted and not failed is Live or Stills", () => {
  assert.equal(cameraStatus("stream", true, false), "live");
  assert.equal(cameraStatus("snapshot", true, false), "stills");
});
it("camera: not painted keeps today's behaviour", () => {
  assert.equal(cameraStatus("stream", false, true), "failed");
  assert.equal(cameraStatus("stream", false, false), "connecting");
});

import assert from "node:assert/strict";
import { it } from "node:test";
import { WEATHER_MAX_STALE_MS, cameraStatus, weatherViewStatus } from "./view-status.ts";

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

const OLD = WEATHER_MAX_STALE_MS + 1;
it("weather: kept data with a fetch error past the age limit is unreachable-empty", () => {
  assert.equal(weatherViewStatus({ ...base, hasError: true, lastOkAgeMs: OLD }), "unreachable-empty");
});
it("weather: exactly at the age limit is still stale", () => {
  assert.equal(weatherViewStatus({ ...base, hasError: true, lastOkAgeMs: WEATHER_MAX_STALE_MS }), "ready-stale");
});
it("weather: an unreachable payload or no data with a kept reading past the limit is unreachable-empty", () => {
  assert.equal(weatherViewStatus({ ...base, payload: "unreachable", hasLastOk: true, lastOkAgeMs: OLD }), "unreachable-empty");
  const none = { ...base, hasData: false, payload: undefined, hasError: true, hasLastOk: true };
  assert.equal(weatherViewStatus({ ...none, lastOkAgeMs: OLD }), "unreachable-empty");
});
it("weather: ready, loading and unconfigured ignore the age; no age is as today", () => {
  assert.equal(weatherViewStatus({ ...base, lastOkAgeMs: OLD * 100 }), "ready");
  assert.equal(weatherViewStatus({ ...base, hasData: false, payload: undefined, isLoading: true, lastOkAgeMs: OLD }), "loading");
  assert.equal(weatherViewStatus({ ...base, payload: "unconfigured", lastOkAgeMs: OLD }), "unconfigured");
  assert.equal(weatherViewStatus({ ...base, hasError: true }), "ready-stale");
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

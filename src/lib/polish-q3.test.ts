import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ApiError } from "./api-error.ts";
import { RESTORE_STILL_RUNNING, restoreSoftFailure } from "./restore-failure.ts";

test("a proxy timeout on a restore says it may still be running", () => {
  for (const status of [502, 504, 524]) {
    assert.equal(restoreSoftFailure(new ApiError(`HTTP ${status}`, status)), RESTORE_STILL_RUNNING);
  }
  assert.equal(RESTORE_STILL_RUNNING, "The restore may still be running. Check again in a few minutes.");
});

test("every other restore failure keeps the plain text", () => {
  assert.equal(restoreSoftFailure(new ApiError("Another job is running", 409)), null);
  assert.equal(restoreSoftFailure(new ApiError("HTTP 500", 500)), null);
  assert.equal(restoreSoftFailure(new TypeError("Failed to fetch")), null);
});

test("the restore action wires the soft failure", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../components/minecraft/backups-panel.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(src, /^\s+softFailure=\{restoreSoftFailure\}\s*$/m);
});

test("the kiosk radar button is no longer a 32px hit box", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../components/kiosk/kiosk-forecast.tsx", import.meta.url)),
    "utf8",
  );
  const button = src.slice(src.indexOf("data-sr-radar"));
  const cls = button.match(/className="([^"]+)"/)![1];
  assert.doesNotMatch(cls, /\bh-8 w-8\b/);
  assert.match(cls, /after:-inset-1\.5/);
  const css = readFileSync(
    fileURLToPath(new URL("../app/kiosk/sunroom/ambient.css", import.meta.url)),
    "utf8",
  );
  assert.match(css, /^\[data-kiosk-theme="sunroom"\] button\[data-sr-radar\]::after \{\s*content: none;/m);
});

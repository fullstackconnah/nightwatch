import { test } from "node:test";
import assert from "node:assert/strict";
import { pinnedSizeState } from "./pinned-size.ts";

const e = { entries: [{}] };
test("pinnedSizeState maps the four states", () => {
  assert.equal(pinnedSizeState({ isLoading: true, hasError: false, scan: undefined }), "loading");
  assert.equal(pinnedSizeState({ isLoading: false, hasError: true, scan: undefined }), "error");
  assert.equal(pinnedSizeState({ isLoading: false, hasError: false, scan: { error: "readdir failed: x", entries: [] } }), "error");
  assert.equal(pinnedSizeState({ isLoading: false, hasError: false, scan: { error: "scan timed out", entries: e.entries } }), "size");
  assert.equal(pinnedSizeState({ isLoading: false, hasError: false, scan: { error: null, entries: [] } }), "size");
  assert.equal(pinnedSizeState({ isLoading: false, hasError: false, scan: undefined }), "none");
});

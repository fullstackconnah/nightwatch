import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, serverMessage } from "./api-error.ts";

describe("serverMessage", () => {
  it("a bare HTTP status gives null", () => {
    assert.equal(serverMessage(new ApiError("HTTP 500", 500)), null);
  });
  it("a real sentence is returned", () => {
    assert.equal(serverMessage(new ApiError("Settings are too large to save.", 413)), "Settings are too large to save.");
  });
  it("a non-ApiError (fetch TypeError) gives null", () => {
    assert.equal(serverMessage(new TypeError("Failed to fetch")), null);
  });
});

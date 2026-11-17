import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, isStepUpRefusal, serverMessage } from "./api-error.ts";

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

describe("isStepUpRefusal", () => {
  it("only the step-up tag counts, whatever the status", () => {
    assert.equal(isStepUpRefusal(new ApiError("Current password is incorrect.", 403, "wrong")), true);
    assert.equal(isStepUpRefusal(new ApiError("Too many attempts.", 429, "limited")), true);
    assert.equal(isStepUpRefusal(new ApiError("cross-site request refused", 403)), false);
    assert.equal(isStepUpRefusal(new ApiError("Kiosk PIN must be 4-8 digits", 400)), false);
    assert.equal(isStepUpRefusal(new TypeError("Failed to fetch")), false);
  });
});

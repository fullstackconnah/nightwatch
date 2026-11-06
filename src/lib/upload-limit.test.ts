import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentLengthError } from "./upload-limit.ts";

const MAX = 8 * 1024 * 1024;

describe("contentLengthError", () => {
  it("answers 411 when Content-Length is missing or empty", () => {
    assert.equal(contentLengthError(null, MAX)?.status, 411);
    assert.equal(contentLengthError("", MAX)?.status, 411);
  });
  it("answers 413 when it is not a finite number, negative, or above the cap", () => {
    assert.equal(contentLengthError("abc", MAX)?.status, 413);
    assert.equal(contentLengthError("Infinity", MAX)?.status, 413);
    assert.equal(contentLengthError("-1", MAX)?.status, 413);
    assert.equal(contentLengthError(String(MAX + 1), MAX)?.status, 413);
  });
  it("lets a length at or under the cap through", () => {
    assert.equal(contentLengthError(String(MAX), MAX), null);
    assert.equal(contentLengthError("1024", MAX), null);
  });
});

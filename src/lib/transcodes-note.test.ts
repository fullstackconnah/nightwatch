import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TRANSCODES_NOTE_COPY, transcodeNote } from "./transcodes-note.ts";

describe("transcodeNote (GPU view transcode streams)", () => {
  it("B1: loading, no error: no note", () => {
    assert.equal(transcodeNote({ txError: false, tx: undefined }), null);
  });
  it("B2: failed, nothing held: load", () => {
    assert.equal(transcodeNote({ txError: true, tx: undefined }), "load");
  });
  it("B3: failed, kept (any variant): stale", () => {
    assert.equal(transcodeNote({ txError: true, tx: { ok: true, streams: [] } }), "stale");
    assert.equal(transcodeNote({ txError: true, tx: { ok: false, reason: "error" } }), "stale");
  });
  it("B4: ok: no note", () => {
    assert.equal(transcodeNote({ txError: false, tx: { ok: true, streams: [] } }), null);
  });
  it("B5: failed then ok: note goes at once", () => {
    assert.equal(transcodeNote({ txError: true, tx: undefined }), "load");
    assert.equal(transcodeNote({ txError: false, tx: { ok: true, streams: [] } }), null);
  });
  it("copy is the pinned sentences", () => {
    assert.equal(TRANSCODES_NOTE_COPY.detail, "The dashboard didn't answer.");
    assert.equal(TRANSCODES_NOTE_COPY.stale, "Sessions may be out of date; the last refresh failed.");
  });
});

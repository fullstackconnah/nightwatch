import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WIDGETS_HINT_COPY, widgetsHint } from "./widgets-hint.ts";

const kept = { sonarr: { type: "sonarr" } };

describe("widgetsHint (Home launcher)", () => {
  it("1: widgets ok gives no hint", () => {
    assert.equal(widgetsHint({ widgetsError: false, widgets: kept, containersError: false }), null);
  });
  it("2: failed with nothing held says it cannot load", () => {
    assert.equal(widgetsHint({ widgetsError: true, widgets: undefined, containersError: false }), "load");
  });
  it("3: failed with kept widgets says may be out of date", () => {
    assert.equal(widgetsHint({ widgetsError: true, widgets: kept, containersError: false }), "stale");
  });
  it("4: failed with an empty widget map (no app has a widget) gives no hint", () => {
    assert.equal(widgetsHint({ widgetsError: true, widgets: {}, containersError: false }), null);
  });
  it("5: Docker note showing: no second note", () => {
    assert.equal(widgetsHint({ widgetsError: true, widgets: undefined, containersError: true }), null);
    assert.equal(widgetsHint({ widgetsError: true, widgets: kept, containersError: true }), null);
  });
  it("6: still loading, no error yet gives no hint", () => {
    assert.equal(widgetsHint({ widgetsError: false, widgets: undefined, containersError: false }), null);
  });
  it("7: failed then a later refresh succeeds: hint goes away", () => {
    assert.equal(widgetsHint({ widgetsError: true, widgets: kept, containersError: false }), "stale");
    assert.equal(widgetsHint({ widgetsError: false, widgets: kept, containersError: false }), null);
  });
  it("copy is the pinned sentences", () => {
    assert.equal(WIDGETS_HINT_COPY.load, "Widget details can't be loaded right now.");
    assert.equal(WIDGETS_HINT_COPY.stale, "Widget details may be out of date; the last refresh failed.");
  });
});

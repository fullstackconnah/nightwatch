import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WIDGETS_HINT_COPY, containerWidgetNote, widgetsHint } from "./widgets-hint.ts";

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

describe("containerWidgetNote (container detail card)", () => {
  const withFields = { fields: [{ label: "a" }] };
  const noFields = { fields: [] };
  const withError = { error: "boom", fields: [] };
  it("A1: ok, fields: no note", () => {
    assert.equal(containerWidgetNote({ widgetsError: false, widgets: kept, widget: withFields }), null);
  });
  it("A2: ok, no widget: no note", () => {
    assert.equal(containerWidgetNote({ widgetsError: false, widgets: kept, widget: undefined }), null);
    assert.equal(containerWidgetNote({ widgetsError: false, widgets: kept, widget: noFields }), null);
  });
  it("A3: ok, widget error: no note", () => {
    assert.equal(containerWidgetNote({ widgetsError: false, widgets: kept, widget: withError }), null);
  });
  it("A4: failed, nothing held: load", () => {
    assert.equal(containerWidgetNote({ widgetsError: true, widgets: undefined, widget: undefined }), "load");
  });
  it("A5: failed, kept fields: stale", () => {
    assert.equal(containerWidgetNote({ widgetsError: true, widgets: kept, widget: withFields }), "stale");
  });
  it("A6: failed, kept, no widget: no note", () => {
    assert.equal(containerWidgetNote({ widgetsError: true, widgets: kept, widget: undefined }), null);
  });
  it("A7: failed, kept, widget error: no note", () => {
    assert.equal(containerWidgetNote({ widgetsError: true, widgets: kept, widget: withError }), null);
  });
  it("A8: failed then ok: note goes at once", () => {
    assert.equal(containerWidgetNote({ widgetsError: true, widgets: kept, widget: withFields }), "stale");
    assert.equal(containerWidgetNote({ widgetsError: false, widgets: kept, widget: withFields }), null);
    assert.equal(containerWidgetNote({ widgetsError: false, widgets: undefined, widget: undefined }), null);
  });
});

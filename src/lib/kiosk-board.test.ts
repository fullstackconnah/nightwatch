import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeToggles, rowOneSpans, rowTwoLayout } from "./kiosk-board.ts";
import { shortenSharedPrefix } from "./kiosk-chip-names.ts";

describe("rowOneSpans: Today and Climate by climate-zone count", () => {
  it("0 zones: Today spans the row and Climate is absent", () => {
    assert.deepEqual(rowOneSpans(0), { today: 12, climate: 0, tileColumns: 0 });
  });
  it("1 zone: 7 / 5 with one tile column", () => {
    assert.deepEqual(rowOneSpans(1), { today: 7, climate: 5, tileColumns: 1 });
  });
  it("2 zones: 5 / 7 with two tile columns", () => {
    assert.deepEqual(rowOneSpans(2), { today: 5, climate: 7, tileColumns: 2 });
  });
  it("3 or more zones: 4 / 8 with three tile columns (4+ wrap)", () => {
    assert.deepEqual(rowOneSpans(3), { today: 4, climate: 8, tileColumns: 3 });
    assert.deepEqual(rowOneSpans(5), { today: 4, climate: 8, tileColumns: 3 });
  });
});

describe("rowTwoLayout: lights and switches beside the scenes panel", () => {
  it("both: 8 / 4, three chip columns, two scene columns", () => {
    assert.deepEqual(rowTwoLayout(true, true), { chips: 8, side: 4, chipColumns: 3, sceneColumns: 2 });
  });
  it("no scenes and no sensors: chips span 12 with four columns", () => {
    assert.deepEqual(rowTwoLayout(true, false), { chips: 12, side: 0, chipColumns: 4, sceneColumns: 0 });
  });
  it("no lights and no switches: the side panel spans 12 with scenes four across", () => {
    assert.deepEqual(rowTwoLayout(false, true), { chips: 0, side: 12, chipColumns: 0, sceneColumns: 4 });
  });
});

const it_ = (entityId: string, name: string, on: boolean) => ({ entityId, name, on });

describe("mergeToggles: one grid, lights then switches", () => {
  const lights = [it_("l1", "Front door Floodlight", true), it_("l2", "Front door Porch", false)];
  const switches = [it_("s1", "Front door Doorbell chime", true), it_("s2", "Kettle", false)];
  const m = mergeToggles(lights, switches);

  it("keeps Home Assistant order inside each group, lights first, no break between", () => {
    assert.deepEqual(m.entries.map((e) => [e.kind, e.item.entityId]), [["light", "l1"], ["light", "l2"], ["switch", "s1"], ["switch", "s2"]]);
  });
  it("counts on of total over both groups", () => {
    assert.equal(m.note, "2 of 4 on");
  });
  it("runs the prefix strip once over the merged names (the group shares 'Front door' across lights and a switch)", () => {
    assert.equal(m.qualifier, "Front door");
    assert.deepEqual(m.entries.map((e) => e.label), ["Floodlight", "Porch", "Doorbell chime", "Kettle"]);
  });
  it("matches shortenSharedPrefix on the merged names exactly", () => {
    const direct = shortenSharedPrefix([...lights, ...switches].map((e) => e.name));
    assert.deepEqual(m.entries.map((e) => e.label), direct.labels);
  });
  it("an empty group still works", () => {
    assert.equal(mergeToggles([], [it_("s", "Kettle", true)]).note, "1 of 1 on");
  });
});

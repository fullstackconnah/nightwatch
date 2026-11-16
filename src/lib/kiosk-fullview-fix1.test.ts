/* Full view board, fix round 1: static guards on the markup the shots script measures (no browser here). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const hub = read("src/components/kiosk/kiosk-hub.tsx");
const marks = read("src/components/kiosk/kiosk-sun-catch.tsx");
const strip = read("src/components/kiosk/kiosk-status-strip.tsx");
const page = read("src/app/kiosk/page.tsx");
const shots = read("scripts/kiosk-shots.mjs");

describe("board chips (items 1 and 2)", () => {
  it("the scene chip renders no idle status text; the name takes the free width", () => {
    assert.ok(!hub.includes("tap to activate"));
    assert.match(hub, /\{statusText && \(/);
    assert.match(hub, /sr-chip-name min-w-\[5ch\] flex-1 truncate[^"]*" title=\{scene\.name\}/);
  });
  it("the toggle chip drops the plain ON/OFF word, keeps its icon and gives the name priority over the sub", () => {
    assert.match(hub, /<SunChipMarks on=\{on\} error=\{!!error\} bare \/>/);
    assert.match(marks, /word && !\(bare && !error\)/);
    assert.match(hub, /<Icon size=\{15\} className=\{cn\("shrink-0"/);
    assert.match(hub, /sr-chip-name min-w-\[5ch\] truncate/);
    assert.match(hub, /sr-chip-sub min-w-0 max-w-24 shrink-\[8\]/);
  });
});

describe("dock and page padding (items 4 to 6)", () => {
  it("the dock groups dissolve below lg so the buttons wrap one by one", () => {
    assert.equal(strip.match(/cn\("[^"]*max-lg:contents/g)?.length, 3);
  });
  it("the page padding is --sr-space-4 from lg and the phone's px-3 below", () => {
    assert.match(page, /px-3 py-3 md:px-5 md:py-4 lg:px-4/);
  });
  it("the shots script has an unpinned (layout=glance) state with Glance in the dock order, and pinned states without it", () => {
    assert.match(shots, /fvVisit\(size, \{ layout: "glance" \}\)/);
    assert.match(shots, /Timer\.\*\\\|Shopping\.\*\\\|View the front door\.\*\\\|Back to glance\.\*\\\|Admin/);
    assert.match(shots, /Timer\.\*\\\|Shopping\.\*\\\|View the front door\.\*\\\|Admin\$/);
  });
});

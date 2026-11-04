/* Rain zones: every kiosk control in the floor band (where rings spawn) carries `data-rain-zone`
 * or sits inside an element that does, and every zone name maps to a mask slot. Static scans, no browser. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RAIN_ZONE_COUNT, RAIN_ZONE_SLOT } from "./kiosk-weather-fx.ts";

const DIR = join(process.cwd(), "src/components/kiosk");
const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
const src = (f: string) => readFileSync(join(DIR, f), "utf8");

/** The opening tag that holds `at`: back to the last `<Tag`, forward to the matching `>` past the `style={{...}}`. */
function openingTag(text: string, at: number): string {
  const starts = [...text.slice(0, at).matchAll(/<[A-Za-z]/g)];
  return text.slice(starts[starts.length - 1].index, at);
}

describe("rain zones: floor-band controls", () => {
  it("every fixed element anchored to the bottom edge (the floor band) carries data-rain-zone, unless aria-hidden", () => {
    const bad: string[] = [];
    for (const f of files) {
      const text = src(f);
      for (const m of text.matchAll(/bottom:\s*"calc\([^"]*safe-area-inset-bottom/g)) {
        const tag = openingTag(text, m.index);
        if (/aria-hidden/.test(tag)) continue;
        if (!/data-rain-zone=/.test(tag)) bad.push(`${f}:${text.slice(0, m.index).split("\n").length}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  it("every widget in glance's below-band stack sits in a zone: glance's zones are plain names, never conditional", () => {
    const text = src("kiosk-glance.tsx");
    assert.deepEqual([...text.matchAll(/data-rain-zone=\{[^}]*\}/g)].map((m) => m[0]), []);
    // the below-band wrapper, the bottom-left cluster and Admin
    assert.ok([...text.matchAll(/data-rain-zone="/g)].length >= 3);
  });

  it("every zone name used in kiosk source has a mask slot (readRects drops unknown names)", () => {
    const names = new Set<string>();
    for (const f of files) for (const m of src(f).matchAll(/data-rain-zone="([a-z-]+)"/g)) names.add(m[1]);
    assert.ok(names.has("playing"));
    assert.deepEqual([...names].filter((n) => !(n in RAIN_ZONE_SLOT)), []);
    assert.equal(Object.keys(RAIN_ZONE_SLOT).length, RAIN_ZONE_COUNT);
  });
});

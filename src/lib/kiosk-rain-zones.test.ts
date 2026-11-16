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
    // the below-band wrapper and the bottom-left cluster; Admin left Glance
    assert.ok([...text.matchAll(/data-rain-zone="/g)].length >= 2);
    assert.doesNotMatch(text, /onAdminClick|data-sr-admin/);
  });

  it("the alert and downloads buttons share one corner zone (slot 3), and neither is fixed on its own", () => {
    assert.equal(RAIN_ZONE_SLOT.corner, 3);
    assert.ok(!("admin" in RAIN_ZONE_SLOT));
    const surface = src("kiosk-surface.tsx");
    assert.match(surface, /data-rain-zone="corner"/);
    for (const f of ["kiosk-alerts.tsx", "kiosk-downloads.tsx"]) {
      const text = src(f);
      assert.match(text, /data-rain-zone="corner"/, f + " tray");
      assert.doesNotMatch(text, /top:s*"calc(1rem + env(safe-area-inset-top))"/, f + " button is a flex item now");
    }
  });

  it("the corner cluster sits under every sheet and its trays clear it by the 12px house gap", () => {
    assert.match(src("kiosk-surface.tsx"), /data-rain-zone="corner"\s+className="fixed z-\(--z-sticky\)/);
    for (const f of ["kiosk-alerts.tsx", "kiosk-downloads.tsx"]) {
      assert.match(src(f), /bottom-\[calc\(5\.5rem\+env.*max-\[640px\]:bottom-\[calc\(9\.75rem\+/, f + " tray offset");
    }
  });

  it("the particles file never loops over a literal 4-slot zone count", () => {
    const text = readFileSync(join(DIR, "kiosk-sunroom-particles.tsx"), "utf8");
    assert.deepEqual([...text.matchAll(/i < (?:16|4).*/g)].map((m) => m[0]), []);
  });

  it("the PIN pad's backdrop (z-50) sits above the corner cluster (z-sticky), and the shots check accepts that backdrop as the cover", () => {
    assert.match(src("kiosk-pin-pad.tsx"), /data-sr-overlay="dialog"\s+className="fixed inset-0 z-50 /);
    assert.match(src("kiosk-surface.tsx"), /data-rain-zone="corner"\s+className="fixed z-\(--z-sticky\) /);
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    assert.match(css, /--z-sticky:\s*20;/);
    const shots = readFileSync(join(process.cwd(), "scripts/kiosk-shots.mjs"), "utf8");
    assert.ok(shots.includes(`closest('[data-sr-overlay="sheet"], [data-sr-overlay="dialog"], [role="dialog"]')`));
  });

  it("every zone name used in kiosk source has a mask slot (readRects drops unknown names)", () => {
    const names = new Set<string>();
    for (const f of files) for (const m of src(f).matchAll(/data-rain-zone="([a-z-]+)"/g)) names.add(m[1]);
    assert.ok(names.has("playing") && names.has("corner"));
    assert.deepEqual([...names].filter((n) => !(n in RAIN_ZONE_SLOT)), []);
    assert.equal(Object.keys(RAIN_ZONE_SLOT).length, RAIN_ZONE_COUNT);
  });
});

describe("rain zones: the full-view dock", () => {
  it("has its own slot (5), not Glance's tiles slot, and the zone count follows", () => {
    assert.equal(RAIN_ZONE_SLOT.dock, 5);
    assert.equal(RAIN_ZONE_COUNT, 6);
    assert.notEqual(RAIN_ZONE_SLOT.dock, RAIN_ZONE_SLOT.tiles);
  });
  it("the dock row is a sibling after the header, carries data-rain-zone=dock and never `tiles`", () => {
    const text = src("kiosk-surface.tsx");
    const headerEnd = text.indexOf("</header>");
    const dock = text.indexOf('data-rain-zone="dock"');
    assert.ok(headerEnd > 0 && dock > headerEnd, "dock row comes after </header>, not inside it");
    assert.doesNotMatch(text, /data-rain-zone="tiles"/);
  });
});

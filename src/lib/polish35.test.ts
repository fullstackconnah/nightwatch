import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { it } from "node:test";

const src = readFileSync(new URL("../components/kiosk/kiosk-display.tsx", import.meta.url), "utf8");
const body = (start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));
const hook = body("export function useKioskBriefing", "/* ── shared bits");
const card = body("function BriefingCard", "\n}");

it("polish 35: the shared hook returns a too-old kept answer as no data; BriefingCard does not re-check", () => {
  assert.match(hook, /briefingTooOld\(getBriefingAnsweredAt\(\), now\)/);
  assert.match(hook, /data: undefined/);
  assert.doesNotMatch(card, /briefingTooOld/);
});

it("polish 35: every useSWR on the briefing key uses the stamping fetcher", () => {
  const root = new URL("../", import.meta.url);
  const hits: string[] = [];
  let seen = 0;
  const walk = (dir: URL) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (dir.pathname.endsWith("/src/") && e.name === "app") continue;
        walk(new URL(`${e.name}/`, dir));
      } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) {
        const text = readFileSync(new URL(e.name, dir), "utf8");
        if (/useSWR[^(]*\([^"]*"\/kiosk\/api\/briefing"/.test(text)) {
          seen++;
          if (!/briefingFetcher/.test(text)) hits.push(e.name);
        }
      }
    }
  };
  walk(root);
  assert.ok(seen >= 1);
  assert.deepEqual(hits, []);
});

it("polish 35: old data polls at the fast rate", () => {
  assert.match(src, /briefingTooOld\(getBriefingAnsweredAt\(\), Date\.now\(\)\) \? undefined : latest/);
});

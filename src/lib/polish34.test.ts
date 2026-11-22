import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { it } from "node:test";

const src = readFileSync(new URL("../components/kiosk/kiosk-display.tsx", import.meta.url), "utf8");
const hook = src.slice(src.indexOf("export function useWeatherView"), src.indexOf("/* ── briefing contract"));

it("polish 34: the weather hook reads the shared time of the last good fetch", () => {
  assert.match(hook, /lastOkAgeMs/);
  assert.match(hook, /getWeatherLastOkAt\(\)/);
  assert.match(hook, /useNow\(true, true\)/);
  assert.doesNotMatch(hook, /onSuccess/);
  assert.doesNotMatch(hook, /setLastOkAt/);
});

it("polish 34: every useSWR on the weather key uses the stamping fetcher", () => {
  const root = new URL("../", import.meta.url);
  const hits: string[] = [];
  const walk = (dir: URL) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (dir.pathname.endsWith("/src/") && e.name === "app") continue;
        walk(new URL(`${e.name}/`, dir));
      } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) {
        const text = readFileSync(new URL(e.name, dir), "utf8");
        if (/useSWR[^(]*\(\s*"\/kiosk\/api\/weather"/.test(text) && !/weatherFetcher/.test(text)) hits.push(e.name);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

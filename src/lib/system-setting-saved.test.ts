import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { systemSetting, systemSettingSaved } from "./config.ts";

// systemSetting() answers "configured" for a saved value OR the env var; the Kiosk PIN card must tell them apart to know whether a Clear can do anything.
function withConfig(system: Record<string, unknown> | null, env: string | undefined, secs: number, fn: () => void) {
  const dir = mkdtempSync(join(tmpdir(), "nw-pin-"));
  if (system) {
    writeFileSync(join(dir, "config.json"), JSON.stringify({ system }));
    utimesSync(join(dir, "config.json"), secs, secs); // config.ts caches by mtime alone: a distinct one per case
  }
  const was = [process.env.DATA_DIR, process.env.KIOSK_PIN];
  process.env.DATA_DIR = dir;
  if (env === undefined) delete process.env.KIOSK_PIN;
  else process.env.KIOSK_PIN = env;
  try {
    fn();
  } finally {
    for (const [k, v] of [["DATA_DIR", was[0]], ["KIOSK_PIN", was[1]]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("an env-only KIOSK_PIN is configured but not saved", () => {
  withConfig(null, "246810", 1_700_000_001, () => {
    assert.equal(Boolean(systemSetting("kioskPin", "KIOSK_PIN")), true);
    assert.equal(systemSettingSaved("kioskPin"), false);
  });
});

test("a PIN saved in config.json is saved, with or without the env var", () => {
  withConfig({ kioskPin: "1234" }, undefined, 1_700_000_002, () => assert.equal(systemSettingSaved("kioskPin"), true));
  withConfig({ kioskPin: "1234" }, "246810", 1_700_000_003, () => assert.equal(systemSettingSaved("kioskPin"), true));
});

test("a blank or missing saved PIN is not saved", () => {
  withConfig({ kioskPin: "  " }, "246810", 1_700_000_004, () => assert.equal(systemSettingSaved("kioskPin"), false));
  withConfig({ updatedAt: "x" }, undefined, 1_700_000_005, () => assert.equal(systemSettingSaved("kioskPin"), false));
});

test("the settings GET sends the boolean only, never the PIN, and the page reads it", () => {
  const route = readFileSync(new URL("../app/api/settings/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(route.includes('kioskPinSaved: systemSettingSaved("kioskPin"),'));
  assert.doesNotMatch(route, /kioskPin:\s/);
});

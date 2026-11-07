import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The route imports "@/" and can't load under node:test, so scan its source.
const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("each secret is kept only through the origin rule", () => {
  for (const re of [
    /secretForUrl\(current\.homeassistant\?\.token,\s*current\.homeassistant\?\.url,\s*url\)/,
    /secretForUrl\(current\.npm\?\.password,\s*current\.npm\?\.url,\s*url\)/,
    /secretForUrl\(current\.forgejo\?\.token,\s*current\.forgejo\?\.url,\s*url\)/,
    /secretForUrl\(current\.minecraft\?\.managerToken,\s*current\.minecraft\?\.managerUrl,\s*managerUrl\)/,
    /rconPasswordForHost\(current\.minecraft\?\.rconPassword,\s*current\.minecraft\?\.rconHost,\s*rconHost\)/,
  ]) assert.match(src, re);
});

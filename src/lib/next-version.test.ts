import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const parse = (v: string) => v.split("-")[0].split(".").map(Number);
const gte = (a: string, b: string) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
};

const installed: string = JSON.parse(
  readFileSync(new URL("../../node_modules/next/package.json", import.meta.url), "utf8"),
).version;

// First patched 15.x release per advisory. All of nightwatch's auth lives in middleware.
const FIRST_PATCHED: Record<string, string> = {
  "CVE-2025-29927 middleware auth bypass (x-middleware-subrequest)": "15.2.3",
  "CVE-2025-66478 RSC flight protocol RCE (GHSA-9qr9-h5gf-34mp)": "15.1.9",
  "RSC DoS / source exposure (GHSA-w37m-7fhw-fmv9, GHSA-mwv6-3258-q52c, GHSA-h25m-26qc-wcjf)": "15.1.12",
  "latest 15.x advisories per npm audit (image optimizer RCE, cache poisoning, SSRF)": "15.5.28",
};

describe("installed next version", () => {
  for (const [advisory, fixed] of Object.entries(FIRST_PATCHED)) {
    it(`is patched for ${advisory}`, () => {
      assert.ok(gte(installed, fixed), `next ${installed} < ${fixed}`);
    });
  }
});

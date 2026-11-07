import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The components load `@/` aliases, which node:test cannot resolve, so scan the source instead.
for (const f of ["proxy-routes.tsx", "proxy-certificates.tsx"]) {
  test(`${f} shows whole days since expiry via the shared helper`, () => {
    const src = readFileSync(new URL(`../../components/integrations/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /Math\.abs\((cert\.)?daysLeft\)/);
    assert.match(src, /daysSinceExpiry/);
  });
}

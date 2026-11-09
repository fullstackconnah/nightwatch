import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import nextConfig from "../../next.config.ts";

// Next compiles `source` with its own path-to-regexp; use the same one so the lookahead is judged as Next judges it.
const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (p: string) => RegExp;
};

const rules = await nextConfig.headers!();
const sent = (path: string) =>
  Object.fromEntries(
    rules.filter((r) => pathToRegexp(r.source).test(path)).flatMap((r) => r.headers.map((h) => [h.key, h.value])),
  );

test("H30 F1: the powered-by header is off", () => {
  assert.equal(nextConfig.poweredByHeader, false);
});

for (const p of ["/", "/settings", "/api/docker/containers", "/login"]) {
  test(`H30 F1: ${p} is framing-protected and hardened`, () => {
    const h = sent(p);
    assert.equal(h["X-Frame-Options"], "DENY");
    assert.equal(h["Content-Security-Policy"], "frame-ancestors 'none'");
    assert.equal(h["X-Content-Type-Options"], "nosniff");
    assert.equal(h["Referrer-Policy"], "same-origin");
  });
}

for (const p of ["/kiosk", "/kiosk/api/vitals"]) {
  test(`H30 F1: ${p} may be framed but keeps nosniff and referrer policy`, () => {
    const h = sent(p);
    assert.equal(h["X-Frame-Options"], undefined);
    assert.equal(h["Content-Security-Policy"], undefined);
    assert.equal(h["X-Content-Type-Options"], "nosniff");
    assert.equal(h["Referrer-Policy"], "same-origin");
  });
}

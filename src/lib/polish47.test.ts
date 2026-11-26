import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("P47-A: a proxy domain is a new-tab link built from routeHref", () => {
  const src = read("../components/integrations/proxy-routes.tsx");
  assert.match(src, /routeHref\(route, domains\[0\]\)/);
  assert.match(src, /target="_blank"/);
  assert.match(src, /rel="noopener noreferrer"/);
  assert.match(src, /aria-label=\{`Open \$\{domains\[0\]\} in a new tab`\}/);
});

test("P47-B: not-found says what happened, links home and reads no data", () => {
  const src = read("../app/not-found.tsx");
  assert.match(src, /This page does not exist/);
  assert.match(src, /The address may be mistyped, or the page has moved\./);
  assert.match(src, /<NotFoundHomeLink \/>/);
  assert.match(read("../components/not-found-home-link.tsx"), /notFoundHome\(usePathname\(\)\)/);
  assert.match(read("../lib/not-found-home.ts"), /href: "\/", label: "Back to Home"/);
  assert.doesNotMatch(src, /@\/lib|fetch\(|cookies\(|headers\(/);
});

test("P47-B: the (dash) segment re-exports the same page so a missing container keeps the chrome", () => {
  assert.match(read("../app/(dash)/not-found.tsx"), /export \{ default \} from "@\/app\/not-found"/);
});

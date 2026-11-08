import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SRC = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

test("both container-detail back links keep a 44 px touch floor on mobile only", () => {
  const page = readFileSync(`${SRC}app/(dash)/containers/[id]/page.tsx`, "utf8");
  const links = page.split(/\r?\n/).filter((l) => /^\s*<Link href="\/docker\?find=containers"/.test(l));
  assert.equal(links.length, 2);
  for (const l of links) assert.match(l, /min-h-11 md:min-h-0/);
});

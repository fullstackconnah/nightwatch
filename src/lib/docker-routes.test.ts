import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const KINDS = ["containers", "images", "volumes"];
const REDIRECTS = KINDS.map((n) => join(SRC, "app", "(dash)", n, "page.tsx"));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const OLD_ROUTE = /["'`]\/(containers|images|volumes)["'`?#]/;

test("C6: no href or push to the three old list routes outside the redirect pages", () => {
  const hits: string[] = [];
  for (const f of walk(SRC)) {
    if (REDIRECTS.includes(f) || /\.test\.ts$/.test(f)) continue;
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (OLD_ROUTE.test(line)) hits.push(`${f.slice(SRC.length)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("C6: each old page redirects with redirect(), never permanentRedirect", () => {
  for (const [i, kind] of KINDS.entries()) {
    const src = readFileSync(REDIRECTS[i], "utf8");
    assert.match(src, new RegExp(`redirect\\("/docker\\?find=${kind}"\\)`));
    assert.doesNotMatch(src, /permanentRedirect/);
  }
});

test("C5: Network is in Monitor with href /networks, and there is no Inventory group", () => {
  const nav = readFileSync(join(SRC, "components", "side-nav.tsx"), "utf8");
  const monitor = nav.slice(nav.indexOf('label: "Monitor"'), nav.indexOf('label: "Integrations"'));
  assert.match(monitor, /href: "\/docker", label: "Docker"/);
  assert.match(monitor, /href: "\/networks", label: "Network"/);
  assert.doesNotMatch(nav, /Inventory/);
});

test("C3 and C1n: the docker components never say proposed and keep bad/warn out of rest styles", () => {
  for (const f of walk(join(SRC, "components", "docker"))) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /proposed/i, f);
    if (!f.endsWith("answer.tsx")) assert.doesNotMatch(src, /\b(text|bg|border)-(bad|warn)\b|--color-(bad|warn)|variant="danger"/, f);
  }
  const resources = join(SRC, "components", "resources");
  for (const n of ["image-delete-action.tsx", "reclaim-shared.tsx"]) {
    assert.doesNotMatch(readFileSync(join(resources, n), "utf8"), /hover:text-bad|hover:bg-bad/, n);
  }
  const prune = readFileSync(join(resources, "reclaim-shared.tsx"), "utf8");
  assert.match(prune, /Yes, prune/);
  assert.doesNotMatch(prune, />\s*Confirm\s*</);
});

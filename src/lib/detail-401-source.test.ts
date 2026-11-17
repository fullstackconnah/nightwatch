import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/* A signed-out detail tab must go to /login like every SWR page: the plain fetches share one 401 rule with `fetcher`. client.ts imports through `@/`, so it is scanned as text. */
const SRC = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const page = read("app/(dash)/containers/[id]/page.tsx");
const remove = read("components/resources/remove-container-action.tsx");
const client = read("lib/client.ts");

describe("401 goes to login in the plain fetches", () => {
  it("client.ts exports the helper and the fetcher uses it", () => {
    assert.match(client, /export function redirectOn401\(res: Response\)/);
    assert.match(client, /export const fetcher[\s\S]*?redirectOn401\(res\)/);
  });
  it("the stats poll and the env reveal call it right after their fetch", () => {
    assert.equal((page.match(/\bfetch\(/g) ?? []).length, 2);
    assert.equal((page.match(/redirectOn401\(res\)/g) ?? []).length, 2);
  });
  it("the container remove DELETE calls it", () => {
    assert.match(remove, /redirectOn401\(res\)/);
  });
  for (const f of ["components/minecraft/pack-browser.tsx", "components/minecraft/upload-pack.tsx", "components/resources/image-delete-action.tsx"]) {
    it(`${f} calls it right after its fetch`, () => {
      assert.match(read(f), /await fetch\([\s\S]*?\);\r?\n\s*redirectOn401\(res\);/);
    });
  }
});

describe("401 goes to login in the shared POST and PUT helpers", () => {
  for (const name of ["postJson", "putJson"]) {
    it(`${name} calls redirectOn401`, () => {
      const body = client.slice(client.indexOf(`export async function ${name}(`)).split(/\r?\n}\r?\n/)[0];
      assert.match(body, /redirectOn401\(res\)/);
    });
  }
  it("only the password post keeps its own 401 (wrong current password)", () => {
    assert.match(client, /opts\?: \{ own401\?: boolean \}/);
    assert.match(read("components/settings/settings-access.tsx"), /postJson\("\/api\/settings\/password",[^\n]*\{ own401: true \}\)/);
  });
});

describe("env row control", () => {
  it("announces the error and keeps one width", () => {
    assert.match(page, /role="status"[^>]*>Couldn&apos;t load/);
    assert.match(page, /min-w-24 shrink-0/);
    assert.doesNotMatch(page, /min-w-11/);
  });
});

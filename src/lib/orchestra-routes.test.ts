import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-level pin (like middleware-matcher.test.ts): the guard must be the first statement of each GET.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const GUARD = String.raw`\{\s*const denied = await requireFullSession\(req\);\s*if \(denied\) return denied;`;

test("status route checks the full session before anything else", () => {
  assert.match(read("../app/api/orchestra/status/route.ts"), new RegExp(String.raw`export async function GET\(req: NextRequest\) ` + GUARD));
});

test("detail route checks the full session first, then validates the name before the lookup", () => {
  const src = read("../app/api/orchestra/orchestrators/[name]/route.ts");
  assert.match(src, new RegExp(String.raw`export async function GET\(req: NextRequest, [^)]*\)[^{]*` + GUARD));
  assert.match(src, /ORCHESTRA_NAME\.test\(name\)[\s\S]*getOrchestraDetail\(name\)/);
});

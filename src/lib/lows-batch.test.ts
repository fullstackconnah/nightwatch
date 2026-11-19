import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

test("A: a failed smart-home action rolls back, then refetches without waiting", () => {
  const src = read("./use-ha.ts");
  assert.match(
    src,
    /await mutate\(previous, \{ revalidate: false \}\);\s*void mutate\(\);[^\n]*\s*const message[\s\S]*?setActionErrors/,
  );
  assert.ok(!/await mutate\(\)/.test(src), "no awaited zero-argument refetch");
});

test("B: log scrollback reads carry the request signal and stop once the client closed", () => {
  const route = read("../app/api/logs/stream/route.ts");
  assert.match(route, /readContainerLogTail\(name, tail, undefined, request\.signal\)/);
  assert.match(route, /readContainerLogTail\(name, 0, since, request\.signal\)/);
  // seed catch tests `closed` before logging
  assert.match(route, /catch \(err\) \{\s*if \(closed\) return "";\s*console\.error\(`log scrollback read failed/);
  // a `closed` test sits between the seed write loop and the replay Promise.all
  assert.match(route, /safeEnqueue\(chunk\);[\s\S]*?if \(closed\) return;\s*await Promise\.all\(\s*names\.map\(/);
  const stream = read("./log-stream.ts");
  assert.ok(stream.includes("signal?.throwIfAborted()"));
  assert.ok(stream.includes("AbortSignal.any("));
  assert.ok(stream.includes("oneShotLogOptions(tail, sinceMs, LOG_TAIL_MAX, DOCKER_LOGS_MS)"));
});

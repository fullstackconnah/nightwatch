import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyImages } from "./image-reclaim.ts";
import { removeVolumes, VolumePruneError } from "./orphan-volumes.ts";

// The route files import "@/lib/docker", which node:test cannot resolve, so they are source-scanned.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const ROUTE = (p: string) => read(`app/api/docker/${p}/route.ts`);

test("A8: list routes log the upstream error and return fixed text, never e.message", () => {
  for (const p of ["images", "networks", "disk-usage"]) {
    const src = ROUTE(p);
    assert.doesNotMatch(src, /e instanceof Error \? e\.message/, p);
    assert.match(src, /console\.error\(/, p);
    assert.match(src, /error: "Docker unreachable\."/, p);
  }
});

test("A8: prune and image-delete explain() return no upstream message on a 500", () => {
  for (const p of ["prune", "images/[id]"]) {
    const src = ROUTE(p);
    assert.doesNotMatch(src, /\$\{message\}/, p);
    assert.match(src, /console\.error\(/, p);
  }
  assert.match(ROUTE("prune"), /\n  return `Docker failed to prune \$\{target\}\.`;/);
  assert.match(ROUTE("images/[id]"), /\n  return "Docker failed to delete it\.";/);
});

test("A8: explain() never falls back to the raw error message", () => {
  for (const p of ["prune", "images/[id]"]) assert.doesNotMatch(ROUTE(p), /return message;/, p);
});

test("A3: a Docker 409 on image delete is not claimed to be an in-use container", () => {
  const src = ROUTE("images/[id]");
  assert.match(
    src,
    /status === 409\) return "Docker won't delete this image\. It may have more than one tag, or a container just started using it\."/,
  );
  assert.doesNotMatch(src, /a container is still using it/);
});

test("A5: one failed removal keeps the others and is reported", async () => {
  const seen: string[] = [];
  const res = await removeVolumes(["a", "b", "c"], async (n) => {
    seen.push(n);
    if (n === "b") throw Object.assign(new Error("boom"), { statusCode: 500 });
  });
  assert.deepEqual(seen, ["a", "b", "c"]);
  assert.deepEqual([res.removed, res.skipped, res.failed], [["a", "c"], [], ["b"]]);
  const err = new VolumePruneError(res.removed.length, 3);
  assert.equal(err.message, "Removed 2 of 3 volumes. Docker refused to remove the rest.");
  assert.deepEqual(err.removed, 2);
});

test("A5: prune route passes the partial-removal text through", () => {
  assert.match(ROUTE("prune"), /e instanceof VolumePruneError/);
});

test("A4: network container counts include stopped containers", () => {
  assert.match(ROUTE("networks"), /docker\.listContainers\(\{ all: true \}\)/);
});

test("A1: a dangling image a container uses is not counted as dangling", () => {
  const images = [
    { Id: "used", RepoTags: ["<none>:<none>"], Size: 10, Created: 1 },
    { Id: "free", RepoTags: [], Size: 20, Created: 2 },
    { Id: "tagged", RepoTags: ["x:1"], Size: 30, Created: 3 },
  ];
  const r = classifyImages(images, new Set(["used"]));
  assert.deepEqual(r.dangling.map((d) => d.id), ["free"]);
  assert.equal(r.danglingBytes, 20);
  assert.equal(r.unusedBytes, 50);
});

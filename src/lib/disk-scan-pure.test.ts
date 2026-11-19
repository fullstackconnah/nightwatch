import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileIdentity, newIdentityFilter, readWalkDir } from "./disk-scan-pure.ts";

// Mirrors the duplicates job: identity filter first, then group by size.
function sizeGroups(files: string[]) {
  const isFirst = newIdentityFilter();
  const bySize = new Map<number, string[]>();
  for (const f of files) {
    const st = fs.lstatSync(f);
    if (!isFirst(fileIdentity(st))) continue;
    bySize.set(st.size, [...(bySize.get(st.size) ?? []), f]);
  }
  return [...bySize.entries()].filter(([, l]) => l.length >= 2).map(([size, l]) => ({ size, files: l, wasted: size * (l.length - 1) }));
}

function withTree(fn: (dir: string, link: (a: string, b: string) => void) => void, t: { skip: (r: string) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dupchk-"));
  try {
    fn(dir, (a, b) => fs.linkSync(path.join(dir, a), path.join(dir, b)));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EPERM") t.skip("hardlinks not supported in the temp folder");
    else throw e;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const put = (dir: string, name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);

test("two hardlinks to one file form no group", (t) => {
  withTree((dir, link) => {
    put(dir, "a", "x".repeat(100));
    link("a", "b");
    assert.deepEqual(sizeGroups([path.join(dir, "a"), path.join(dir, "b")]), []);
  }, t);
});

test("two hardlinks plus a real copy form one group of 2, wasted = one size", (t) => {
  withTree((dir, link) => {
    put(dir, "a", "x".repeat(100));
    link("a", "b");
    put(dir, "c", "x".repeat(100));
    const g = sizeGroups(["a", "b", "c"].map((n) => path.join(dir, n)));
    assert.equal(g.length, 1);
    assert.deepEqual(g[0].files, [path.join(dir, "a"), path.join(dir, "c")]);
    assert.equal(g[0].wasted, 100);
  }, t);
});

test("two separate files with equal content still form a group", (t) => {
  withTree((dir) => {
    put(dir, "a", "x".repeat(100));
    put(dir, "c", "x".repeat(100));
    const g = sizeGroups([path.join(dir, "a"), path.join(dir, "c")]);
    assert.equal(g.length, 1);
    assert.equal(g[0].wasted, 100);
  }, t);
});

const read = (p: string) => fs.readdirSync(p);

// Unreadable scan root: the walk must fail loudly for the root, skip silently below it.
test("readWalkDir throws for an unreadable root, naming the typed path and not the host path", () => {
  const missing = path.join(os.tmpdir(), "nw-gone-" + process.pid);
  assert.throws(
    () => readWalkDir(read,`/host/rootfs${missing}`, "/mnt/gone", "/mnt/gone"),
    (e: Error) => e.message.startsWith("cannot read /mnt/gone: ") && !e.message.includes("/host/rootfs") && /ENOENT/.test(e.message),
  );
});

test("readWalkDir skips an unreadable subfolder and reads a readable root, empty or not", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nw-walk-"));
  try {
    assert.deepEqual(readWalkDir(read,root, "/r", "/r"), []);
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    assert.equal(readWalkDir(read,root, "/r", "/r")?.length, 1);
    assert.equal(readWalkDir(read,path.join(root, "nope"), "/r/nope", "/r"), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

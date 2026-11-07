import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import { after, before, describe, it } from "node:test";
import { createGuard } from "./fsguard.ts";
import { purgeHold, realFs, recoverSwap, SwapError, swapIn, undoSwap, type SwapFs, type SwapPlan } from "./swap.ts";
import { SKIP_OFF_LINUX, tempDir } from "./testkit.ts";

let root: string;
let guard: ReturnType<typeof createGuard>;
let n = 0;

before(() => {
  root = tempDir("mw-swap-");
  for (const d of ["hold", "work", "calib", "movies"]) mkdirSync(join(root, d));
  guard = createGuard({ hold: join(root, "hold"), work: join(root, "work"), calibration: join(root, "calib") });
});
after(() => rmSync(root, { recursive: true, force: true }));

/** A fresh source ("original") and output (".part") pair, and the plan for them. */
function fixture(): SwapPlan & { id: string } {
  const id = `job${++n}`;
  const src = join(root, "movies", `${id}.mkv`);
  const part = join(root, "work", `${id}.part`);
  writeFileSync(src, "ORIGINAL");
  writeFileSync(part, "OUTPUT");
  const st = statSync(src);
  const holdDir = join(root, "hold", id);
  return {
    id, src, part, holdRoot: join(root, "hold"), holdDir, holdFile: join(holdDir, `${id}.mkv`),
    srcIno: st.ino, srcSize: st.size, srcMtimeMs: st.mtimeMs, srcMode: st.mode,
  };
}

/** Wraps realFs so each call is logged and one of them can throw. */
function spy(throwAt?: string): { fs: SwapFs; calls: string[] } {
  const calls: string[] = [];
  const wrap = <K extends keyof SwapFs>(k: K): SwapFs[K] =>
    ((...a: unknown[]) => {
      calls.push(k === "fsyncDir" || k === "fsyncFile" ? `${k}:${String(a[0])}` : k);
      if (k === throwAt) throw new Error(`boom at ${k}`);
      return (realFs[k] as (...x: unknown[]) => unknown)(...a);
    }) as SwapFs[K];
  const fs = Object.fromEntries((Object.keys(realFs) as (keyof SwapFs)[]).map((k) => [k, wrap(k)])) as unknown as SwapFs;
  return { fs, calls };
}

// shortcut: NTFS inodes exceed 2^53 as numbers; Linux-only, upgrade to bigint stats if the worker ever runs on Windows
const NTFS_INO: string | false = process.platform === "win32" ? "NTFS inodes exceed 2^53" : false;

describe("swapIn (B5, M3, S6)", () => {
  it("the path then holds the output and the hold folder holds the original", { skip: NTFS_INO }, () => {
    const p = fixture();
    const r = swapIn(realFs, guard, p, () => {});
    assert.equal(readFileSync(p.src, "utf8"), "OUTPUT");
    assert.equal(readFileSync(p.holdFile, "utf8"), "ORIGINAL");
    assert.equal(statSync(p.src).ino, r.newIno);
    assert.equal(existsSync(p.part), false);
  });

  it("fsync order: output, link, hold/<id>, hold, chmod, rename, source folder (M3)", () => {
    const p = fixture();
    const { fs, calls } = spy();
    swapIn(fs, guard, p, () => calls.push("journal"));
    const names = calls.filter((c) => c !== "lstat" && c !== "mkdir");
    assert.deepEqual(names, [
      `fsyncFile:${p.part}`, "journal", "link",
      `fsyncDir:${p.holdDir}`, `fsyncDir:${p.holdRoot}`, "chmod", "rename", `fsyncDir:${dirname(p.src)}`,
    ]);
  });

  it("a poller never sees the path missing while the swap runs", { skip: SKIP_OFF_LINUX }, async () => {
    const p = fixture();
    const flag = new Int32Array(new SharedArrayBuffer(8));
    const w = new Worker(
      `const {workerData:{path,flag}}=require("node:worker_threads");const fs=require("node:fs");let miss=0;
       while(Atomics.load(flag,0)===0){try{fs.accessSync(path)}catch{miss++}} flag[1]=miss;`,
      { eval: true, workerData: { path: p.src, flag } },
    );
    await new Promise((r) => setTimeout(r, 50));
    swapIn(realFs, guard, p, () => {});
    Atomics.store(flag, 0, 1);
    await new Promise((r) => w.on("exit", r));
    assert.equal(flag[1], 0);
  });

  it("S6: a source replaced before the swap is refused and nothing is linked", () => {
    const p = fixture();
    rmSync(p.src);
    writeFileSync(p.src, "SOMEONE ELSE'S FILE");
    assert.throws(() => swapIn(realFs, guard, p, () => {}), (e: unknown) => e instanceof SwapError && e.check === "source-changed");
    assert.equal(readFileSync(p.src, "utf8"), "SOMEONE ELSE'S FILE");
    assert.equal(existsSync(p.holdDir), false);
  });
});

describe("swapIn path re-check (S6, F2)", () => {
  it("the path rule failing at the swap refuses the job and links nothing", () => {
    const p = fixture();
    assert.throws(() => swapIn(realFs, guard, p, () => {}, () => false), (e: unknown) => e instanceof SwapError && e.check === "source-changed");
    assert.equal(readFileSync(p.src, "utf8"), "ORIGINAL");
    assert.equal(existsSync(p.holdDir), false);
  });

  it("a hold link whose inode is not the original's is removed and the job refused", () => {
    const p = fixture();
    const odd: SwapFs = { ...realFs, lstat: (f) => (f === p.holdFile ? { ...realFs.lstat(f), ino: -1 } : realFs.lstat(f)) };
    assert.throws(() => swapIn(odd, guard, p, () => {}), (e: unknown) => e instanceof SwapError && e.check === "source-changed");
    assert.equal(existsSync(p.holdFile), false);
    assert.equal(existsSync(p.holdDir), false);
    assert.equal(readFileSync(p.src, "utf8"), "ORIGINAL");
  });
});

describe("recoverSwap (M2)", () => {
  it("a throw after link and before rename: the original stays, the hold link goes, the job fails", { skip: NTFS_INO }, () => {
    const p = fixture();
    const { fs } = spy("rename");
    assert.throws(() => swapIn(fs, guard, p, () => {}), /boom at rename/);
    const out = realFs.lstat(p.part).ino;
    const r = recoverSwap(realFs, guard, p, out);
    assert.equal(r.result, "failed");
    assert.match((r as { message: string }).message, /original was not touched/);
    assert.equal(readFileSync(p.src, "utf8"), "ORIGINAL");
    assert.equal(existsSync(p.holdFile), false);
    assert.equal(existsSync(p.part), false);
  });

  it("a throw after rename: the job is done", () => {
    const p = fixture();
    const { fs } = spy("fsyncDir");
    // the first two fsyncDir calls (hold folders) pass; make only the last one (source folder) throw
    let dirCalls = 0;
    const late: SwapFs = { ...fs, fsyncDir: (d) => { if (++dirCalls === 3) throw new Error("boom late"); realFs.fsyncDir(d); } };
    let outIno = 0;
    assert.throws(() => swapIn(late, guard, p, (i) => { outIno = i; }), /boom late/);
    const r = recoverSwap(realFs, guard, p, outIno);
    assert.equal(r.result, "done");
    assert.equal(readFileSync(p.src, "utf8"), "OUTPUT");
    assert.equal(readFileSync(p.holdFile, "utf8"), "ORIGINAL");
  });

  it("answer 4: recovering an already completed swap again touches nothing and stays done", { skip: NTFS_INO }, () => {
    const p = fixture();
    const r = swapIn(realFs, guard, p, () => {});
    for (const holdGone of [false, true]) {
      if (holdGone) { rmSync(p.holdFile); rmSync(p.holdDir, { recursive: true }); }
      const rec = recoverSwap(realFs, guard, p, r.newIno);
      assert.deepEqual(rec, { result: "done", newIno: r.newIno, newSize: r.newSize });
      assert.equal(readFileSync(p.src, "utf8"), "OUTPUT");
      assert.equal(existsSync(p.holdFile), !holdGone);
    }
  });

  it("M2: the source replaced by a third file and the hold file linked twice: keepHold, hold file stays", () => {
    const p = fixture();
    const { fs } = spy("rename");
    assert.throws(() => swapIn(fs, guard, p, () => {}));
    rmSync(p.src);
    writeFileSync(p.src, "THIRD FILE");
    linkSync(p.holdFile, join(root, "movies", `${p.id}.extra`));
    const r = recoverSwap(realFs, guard, p, 0);
    assert.equal(r.result, "failed");
    assert.equal((r as { keepHold: boolean }).keepHold, true);
    assert.equal(readFileSync(p.holdFile, "utf8"), "ORIGINAL");
    assert.equal(readFileSync(p.src, "utf8"), "THIRD FILE");
  });

  it("source deleted while swapping: the hold file is kept and nothing is purged", () => {
    const p = fixture();
    const { fs } = spy("rename");
    assert.throws(() => swapIn(fs, guard, p, () => {}));
    rmSync(p.src);
    const r = recoverSwap(realFs, guard, p, 0);
    assert.equal(r.result, "failed");
    assert.equal((r as { keepHold: boolean }).keepHold, true);
    assert.match((r as { message: string }).message, /kept in the hold folder/);
    assert.equal(readFileSync(p.holdFile, "utf8"), "ORIGINAL");
  });
});

describe("undoSwap and purgeHold (B5, N4)", () => {
  it("Undo puts the original back and removes the hold folder", () => {
    const p = fixture();
    const r = swapIn(realFs, guard, p, () => {});
    undoSwap(realFs, guard, p, r.newIno, r.newSize);
    assert.equal(readFileSync(p.src, "utf8"), "ORIGINAL");
    assert.equal(existsSync(p.holdDir), false);
  });

  it("Undo after the file was replaced is a 409 and nothing moves", () => {
    const p = fixture();
    const r = swapIn(realFs, guard, p, () => {});
    writeFileSync(p.src, "REPLACED BY THE USER");
    assert.throws(() => undoSwap(realFs, guard, p, r.newIno, r.newSize), (e: unknown) => e instanceof SwapError && e.status === 409);
    assert.equal(readFileSync(p.src, "utf8"), "REPLACED BY THE USER");
    assert.equal(readFileSync(p.holdFile, "utf8"), "ORIGINAL");
  });

  it("purge deletes the held original and its folder; a missing file counts as purged", () => {
    const p = fixture();
    swapIn(realFs, guard, p, () => {});
    purgeHold(guard, p);
    assert.equal(existsSync(p.holdDir), false);
    purgeHold(guard, p);
  });
});

describe("only fsguard.ts deletes (B5)", () => {
  it("no unlink, rm or rmdir call exists in the worker's source outside fsguard.ts", () => {
    const dir = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const hits: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "testkit.ts" || f === "fsguard.ts") continue;
      readFileSync(join(dir, f), "utf8").split("\n").forEach((line, i) => {
        if (/\b(unlinkSync|rmSync|rmdirSync|unlink|rmdir|rm)\s*\(/.test(line) && !/^\s*\/\//.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
    assert.deepEqual(hits, []);
  });
});

void linkSync;

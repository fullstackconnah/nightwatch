// The swap, Undo and purge (PLAN B5 with plan-check M2, M3, S6, N4). The original is never deleted by a swap:
// it is hard-linked into the hold folder first, and only a purge (7 days after `done`) removes it.
import { chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { Guard } from "./fsguard.ts";

export class SwapError extends Error {
  status: number;
  check?: "source-changed" | "swap";
  constructor(status: number, message: string, check?: "source-changed" | "swap") {
    super(message);
    this.status = status;
    this.check = check;
  }
}

export interface FsStat { ino: number; size: number; mtimeMs: number; mode: number; nlink: number; uid: number }

/** The fs calls the swap makes, injected so a test can spy on their order or throw between two of them. */
export interface SwapFs {
  link(from: string, to: string): void;
  rename(from: string, to: string): void;
  chmod(p: string, mode: number): void;
  lstat(p: string): FsStat;
  mkdir(p: string): void;
  fsyncFile(p: string): void;
  fsyncDir(p: string): void;
}

export const realFs: SwapFs = {
  link: linkSync,
  rename: renameSync,
  chmod: chmodSync,
  lstat: (p) => lstatSync(p),
  mkdir: (p) => { mkdirSync(p); },
  fsyncFile(p) { const fd = openSync(p, "r+"); try { fsyncSync(fd); } finally { closeSync(fd); } },
  fsyncDir(p) {
    try {
      const fd = openSync(p, "r");
      try { fsyncSync(fd); } finally { closeSync(fd); }
    } catch (e) {
      // shortcut: Windows can't open a folder for fsync; the worker runs on Linux, so only skip there.
      if (process.platform !== "win32") throw e;
    }
  },
};

export interface SwapPlan {
  src: string;
  part: string;
  holdRoot: string;
  holdDir: string;
  holdFile: string;
  srcIno: number;
  srcSize: number;
  srcMtimeMs: number;
  srcMode: number;
}

const lstatOrNull = (fs: SwapFs, p: string): FsStat | null => {
  try { return fs.lstat(p); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
};

/** removeInside that treats "already gone" as done. */
export function rmQuiet(guard: Guard, dir: string, p: string, opts: { purge?: boolean } = {}): void {
  try { guard.removeInside(dir, p, opts); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/**
 * Journal, link the original into the hold folder, then rename the output over it. Order (M3): fsync the output,
 * link, fsync hold/<id> and hold, chmod, rename, fsync the source folder. The caller writes `done` after this returns.
 */
export function swapIn(
  fs: SwapFs, guard: Guard, plan: SwapPlan, journal: (outIno: number, outSize: number) => void,
  pathOk: () => boolean = () => true,
): { newIno: number; newSize: number } {
  fs.fsyncFile(plan.part);
  const out = fs.lstat(plan.part);
  journal(out.ino, out.size);

  const now = lstatOrNull(fs, plan.src);
  // S6: the path rule is re-run here too, so a folder swapped for a symlink during a long encode is refused.
  if (!pathOk() || !now || now.ino !== plan.srcIno || now.size !== plan.srcSize || now.mtimeMs !== plan.srcMtimeMs) {
    throw new SwapError(409, "The source file changed during compression", "source-changed");
  }
  fs.mkdir(plan.holdDir);
  fs.link(plan.src, plan.holdFile);
  if (fs.lstat(plan.holdFile).ino !== plan.srcIno) {
    // The source was replaced between the check and the link: the hold link now points at someone else's file.
    rmQuiet(guard, plan.holdRoot, plan.holdFile);
    rmQuiet(guard, plan.holdRoot, plan.holdDir);
    throw new SwapError(409, "The source file changed during compression", "source-changed");
  }
  fs.fsyncDir(plan.holdDir);
  fs.fsyncDir(plan.holdRoot);
  fs.chmod(plan.part, plan.srcMode & 0o7777);
  fs.rename(plan.part, plan.src);
  fs.fsyncDir(dirname(plan.src));
  return { newIno: out.ino, newSize: out.size };
}

export type Recovery =
  | { result: "done"; newIno: number; newSize: number }
  | { result: "failed"; message: string; keepHold: boolean };

/** A job found in `swapping` at boot (M2): decide from what the source path points at, never delete the only copy. */
export function recoverSwap(fs: SwapFs, guard: Guard, plan: SwapPlan, outIno: number): Recovery {
  const now = lstatOrNull(fs, plan.src);
  if (now && now.ino === outIno) return { result: "done", newIno: now.ino, newSize: now.size };
  if (now && now.ino === plan.srcIno) {
    try {
      rmQuiet(guard, plan.holdRoot, plan.holdFile);
      rmQuiet(guard, plan.holdRoot, plan.holdDir);
      rmQuiet(guard, guard.dirs.work, plan.part);
      return { result: "failed", message: "Interrupted while swapping; the original was not touched", keepHold: false };
    } catch { /* fall through: keep whatever is left */ }
  }
  return { result: "failed", message: "Interrupted while swapping; the original is kept in the hold folder", keepHold: true };
}

/** Puts the original back over the compressed file; refuses if the path no longer holds exactly that output. */
export function undoSwap(fs: SwapFs, guard: Guard, plan: SwapPlan, newIno: number, newSize: number): void {
  const now = lstatOrNull(fs, plan.src);
  if (!now || now.ino !== newIno || now.size !== newSize) throw new SwapError(409, "The file was changed after compressing");
  if (!lstatOrNull(fs, plan.holdFile)) throw new SwapError(409, "The original is no longer in the hold folder");
  fs.rename(plan.holdFile, plan.src);
  fs.fsyncDir(dirname(plan.src));
  rmQuiet(guard, plan.holdRoot, plan.holdDir);
}

/** Deletes the held original (the only place a hold file may go). A missing file counts as purged (N4). */
export function purgeHold(guard: Guard, plan: Pick<SwapPlan, "holdRoot" | "holdDir" | "holdFile">): void {
  rmQuiet(guard, plan.holdRoot, plan.holdFile, { purge: true });
  rmQuiet(guard, plan.holdRoot, plan.holdDir);
}

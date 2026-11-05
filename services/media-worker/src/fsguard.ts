// The only module in the worker that deletes anything (a source-text test enforces it). Every delete names the
// folder it must be inside, and that folder must be one of the three the worker owns.
import { lstatSync, realpathSync, rmdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export interface GuardDirs {
  hold: string;
  work: string;
  calibration: string;
}

export function createGuard(dirs: GuardDirs) {
  const allowed = [dirs.hold, dirs.work, dirs.calibration].map((d) => resolve(d));

  /**
   * Deletes one file, or one EMPTY folder, inside `dir`. The parent's realpath must be `dir` itself or below it
   * (so `work-old/` never passes as `work`), and `p` can't be `dir`. A held original with a single link is the
   * only copy of that file: it goes only for a purge, or once a rollback has linked it back (nlink >= 2).
   */
  function removeInside(dir: string, p: string, opts: { purge?: boolean } = {}): void {
    const root = resolve(dir);
    if (!allowed.includes(root)) throw new Error("Not an allowed folder to delete in");
    const name = basename(p);
    if (!name || name === "." || name === ".." || resolve(p) === root) throw new Error("Refusing to delete a folder itself");
    const parent = realpathSync(dirname(resolve(p)));
    const top = realpathSync(root);
    if (parent !== top && !parent.startsWith(top + sep)) throw new Error("Path is outside the folder");
    const target = join(parent, name);
    const st = lstatSync(target);
    if (st.isDirectory()) return rmdirSync(target);
    if (root === resolve(dirs.hold) && !opts.purge && st.nlink < 2) throw new Error("Refusing to delete the only copy of a file");
    unlinkSync(target);
  }

  return { removeInside, dirs };
}

export type Guard = ReturnType<typeof createGuard>;

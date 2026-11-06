// The only module that writes to disk, and only under the state dir (never the media mount).
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { realFs } from "./swap.ts";

/** Write `.tmp`, fsync, rename. */
export function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, JSON.stringify(data));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
  realFs.fsyncDir(dirname(file)); // F4: the rename itself must survive a power cut
}

/** `strict`: only a missing file reads as null; an unreadable or corrupt one throws, so a caller never overwrites it as if empty. */
export function readJson<T>(file: string, strict = false): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (e) {
    if (!strict || (e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`can't read ${file}: ${(e as Error).message}`);
  }
}

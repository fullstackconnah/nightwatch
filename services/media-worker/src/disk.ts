// Disk guards (PLAN B6) and the readiness check (S5, O5).
import { accessSync, constants, existsSync, mkdirSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DISK_MARGIN_BYTES } from "./sweet-spot.ts";

export type Statfs = (p: string) => { bavail: number | bigint; bsize: number | bigint };

export const freeBytes = (statfs: Statfs, p: string): number => {
  const s = statfs(p);
  return Number(s.bavail) * Number(s.bsize);
};

const gb = (n: number) => (n / 2 ** 30).toFixed(1);

/** "12 Nov" in the worker's time zone (TZ, default Australia/Sydney). */
export const dayLabel = (iso: string, tz = "Australia/Sydney"): string =>
  new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));

/** The 507 body: short, no path. The last sentence only when originals are being held. */
export function diskMessage(sourceBytes: number, free: number, earliestHeldUntil: string | null, tz?: string): string {
  const need = `Needs ${gb(sourceBytes + DISK_MARGIN_BYTES)} GB free to compress this file; ${gb(free)} GB is free.`;
  return earliestHeldUntil
    ? `${need} Space from compressed files comes back when their originals are deleted on ${dayLabel(earliestHeldUntil, tz)}.`
    : need;
}

export const enoughFor = (statfs: Statfs, mediaRoot: string, sourceBytes: number): boolean =>
  freeBytes(statfs, mediaRoot) >= sourceBytes + DISK_MARGIN_BYTES;

export interface Dirs { root: string; hold: string; work: string; calibration: string }

export const dirsFor = (mediaRoot: string): Dirs => {
  const root = join(mediaRoot, ".nightwatch");
  return { root, hold: join(root, "hold"), work: join(root, "work"), calibration: join(root, "calibration") };
};

/**
 * Compress can run only when `.nightwatch` exists, is writable by the worker's uid, and sits on the same disk as
 * movies/ and tv/ (a hard link can't cross disks). Creates hold/, work/ and calibration/ inside it.
 */
export function checkReady(mediaRoot: string): { ready: boolean; reason?: string; dirs: Dirs } {
  const dirs = dirsFor(mediaRoot);
  try {
    accessSync(dirs.root, constants.W_OK);
    for (const d of [dirs.hold, dirs.work, dirs.calibration]) mkdirSync(d, { recursive: true });
    // Jellyfin skips a folder holding .ignore, so held originals never show up as duplicate films.
    if (!existsSync(join(dirs.root, ".ignore"))) writeFileSync(join(dirs.root, ".ignore"), "");
  } catch {
    return { ready: false, reason: "Hold folder missing or not writable", dirs };
  }
  const dev = statSync(dirs.root).dev;
  if (statSync(join(mediaRoot, "movies")).dev !== dev || statSync(join(mediaRoot, "tv")).dev !== dev) {
    return { ready: false, reason: "Hold folder is on a different disk", dirs };
  }
  return { ready: true, dirs };
}

export const realStatfs: Statfs = (p) => statfsSync(p);

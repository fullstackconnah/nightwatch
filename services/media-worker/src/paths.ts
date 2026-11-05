// The single path rule (PLAN §1.4). Every endpoint that takes an id or a path
// turns it into a file only through resolveMediaPath.
import { realpathSync } from "node:fs";
import { posix } from "node:path";

export const DEFAULT_MEDIA_ROOT = "/mnt/media";
export const MEDIA_ROOTS = ["movies", "tv"] as const;
export type MediaRoot = (typeof MEDIA_ROOTS)[number];
export type PathError = { error: string; status: 400 | 404 };

const bad = (error: string): PathError => ({ error, status: 400 });

/** The string rules (steps 1-3); pure, so they run anywhere. */
export function checkRelPath(rel: unknown): { root: MediaRoot; segments: string[] } | PathError {
  if (typeof rel !== "string" || rel.length < 1 || rel.length > 1024) return bad("Bad path");
  if (rel.includes("\0") || rel.includes("\\") || rel.startsWith("/")) return bad("Bad path");
  const segments = rel.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return bad("Bad path");
  const root = MEDIA_ROOTS.find((r) => r === segments[0]);
  if (!root) return bad("Outside the media library");
  // Blocks .nightwatch and hidden files.
  if (segments.some((s) => s.startsWith("."))) return bad("Bad path");
  return { root, segments };
}

/** Steps 1-4: the string rules, then realpath(abs) must equal abs, so a symlink anywhere in the chain is refused. */
export function resolveMediaPath(
  rel: unknown,
  mediaRoot: string = process.env.MEDIA_ROOT ?? DEFAULT_MEDIA_ROOT,
): { abs: string; root: MediaRoot } | PathError {
  const checked = checkRelPath(rel);
  if ("error" in checked) return checked;
  const abs = posix.join(mediaRoot, rel as string);
  try {
    if (realpathSync(abs) !== posix.join(realpathSync(mediaRoot), rel as string)) return bad("Bad path");
  } catch {
    return { error: "Not found", status: 404 };
  }
  return { abs, root: checked.root };
}

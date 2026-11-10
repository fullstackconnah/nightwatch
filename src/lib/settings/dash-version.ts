import { createHash } from "node:crypto";
import type { AppConfig } from "../config.ts";
import { publicWidgets } from "./dash-put.ts";

const TILES = ["groups", "urls", "icons", "hidden"] as const;
const WIDGETS = ["widgets"] as const;
const ALL = [...TILES, ...WIDGETS] as const;

/** Short tag of the saved JSON of the named dashboard sections. Widgets go in as the browser sees them, so a secret never feeds the hash. */
const tag = (config: AppConfig, keys: readonly (typeof ALL)[number][]) =>
  createHash("sha256")
    .update(JSON.stringify(keys.map((k) => (k === "widgets" ? publicWidgets(config.widgets ?? []) : config[k] ?? null))))
    .digest("hex").slice(0, 16);

/** One tag per card: the tile editor and the widget list save independently. */
export const dashVersions = (config: AppConfig) => ({ tiles: tag(config, TILES), widgets: tag(config, WIDGETS) });

export const STALE_DASH_MESSAGE =
  "The dashboard was changed in another tab or device. Reload to get the latest, then make your change again.";

/** null = go ahead; otherwise the refusal. The tag covers exactly the sections this body replaces. */
export function checkBaseVersion(current: AppConfig, body: unknown): { status: 400 | 409; error: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null; // mergeDashPut refuses it
  const b = body as Record<string, unknown>;
  if (b.baseVersion === undefined) return null; // shortcut: tabs from before the version check save unchecked; drop the fallback after a release or two
  if (typeof b.baseVersion !== "string" || b.baseVersion.length > 128) return { status: 400, error: "baseVersion must be a short string" };
  const keys = ALL.filter((k) => b[k] !== undefined);
  if (!keys.length) return null; // mergeDashPut says "nothing to save"
  return tag(current, keys) === b.baseVersion ? null : { status: 409, error: STALE_DASH_MESSAGE };
}

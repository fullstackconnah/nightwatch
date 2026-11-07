import { NextRequest, NextResponse } from "next/server";
import { loadConfig, loadConfigForSave, saveConfig, type AppConfig } from "@/lib/config";
import { resolveAbsolutePath } from "@/lib/disk-usage";
import { applyPin, MAX_PIN_PATH } from "@/lib/settings-checks";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route.

/**
 * Minimal pin store (G5): a dedicated route rather than routing pins through
 * the general /api/settings PUT (which round-trips the WHOLE AppConfig from
 * client state and would race a concurrent settings-page save) — this reads
 * config.json, applies one add/remove, and writes it back atomically per
 * request, the same pattern config.ts's saveConfig already uses for a single
 * field elsewhere in the app.
 */
export async function GET() {
  return NextResponse.json({ pinnedFolders: loadConfig().pinnedFolders ?? [] });
}

export async function POST(req: NextRequest) {
  let body: { path?: unknown; action?: unknown };
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const path = typeof body.path === "string" ? body.path.trim() : "";
  if (!path || !path.startsWith("/")) {
    return NextResponse.json({ error: "path must be a non-empty absolute path" }, { status: 400 });
  }
  const action = body.action;
  if (action !== "pin" && action !== "unpin") {
    return NextResponse.json({ error: 'action must be "pin" or "unpin"' }, { status: 400 });
  }

  if (path.length > MAX_PIN_PATH) {
    return NextResponse.json({ error: `path must be at most ${MAX_PIN_PATH} characters` }, { status: 400 });
  }
  // A trailing slash is dropped first (it used to be accepted), so "/a/" and "/a" are one pin.
  const norm = (p: string) => resolveAbsolutePath(p.length > 1 ? p.replace(/\/+$/, "") || "/" : p);
  const normalized = norm(path);
  if (!normalized) {
    return NextResponse.json({ error: "path must be a non-empty absolute path" }, { status: 400 });
  }

  let config: AppConfig;
  try {
    config = loadConfigForSave();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  const result = applyPin(config.pinnedFolders ?? [], action, normalized, norm);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const next = result.pins;

  try {
    saveConfig({ ...config, pinnedFolders: next });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to save pin" },
      { status: 500 },
    );
  }

  return NextResponse.json({ pinnedFolders: next });
}

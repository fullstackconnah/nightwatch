import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";

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
    body = await req.json();
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

  const config = loadConfig();
  const current = config.pinnedFolders ?? [];
  const next =
    action === "pin"
      ? current.includes(path)
        ? current
        : [...current, path]
      : current.filter((p) => p !== path);

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

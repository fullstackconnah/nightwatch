import { NextRequest, NextResponse } from "next/server";
import { scanDirectoryContents } from "@/lib/disk-usage";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts's session-cookie check on every /api/*
// path, same as every other route in this app — no per-route check here.

/**
 * CONTENTS drill-down (G5): one level of `du`-based breakdown for an
 * arbitrary absolute path, not just a disk group's root (that stays on
 * /api/resources/disk-usage, unchanged). Path traversal safety lives
 * server-side in scanDirectoryContents/resolveAbsolutePath — this route
 * trusts nothing about the incoming string beyond passing it through.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }
  const refresh = searchParams.get("refresh") === "1";

  try {
    const result = await scanDirectoryContents(path, { refresh });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.scan);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "contents scan failed" },
      { status: 502 },
    );
  }
}

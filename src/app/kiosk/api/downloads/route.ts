import { NextResponse } from "next/server";
import { getKioskDownloads } from "@/lib/widgets/builtins";

export const dynamic = "force-dynamic";

/**
 * Public read-only download-tray data for the kiosk. Same public-route shape
 * as /kiosk/api/vitals (force-dynamic, try/catch → 502, logic delegated to a
 * lib fn) — already exempted in middleware.ts (PUBLIC_PATHS matches "/kiosk",
 * which covers "/kiosk/api/*") so a wall tablet can show download progress
 * without an admin session. Never echoes the configured qBittorrent URL or
 * credentials — only per-torrent name/progress/speed/size/eta, and only for
 * torrents currently making progress (see getKioskDownloads).
 */
export async function GET() {
  try {
    return NextResponse.json(await getKioskDownloads());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "downloads unavailable" },
      { status: 502 },
    );
  }
}

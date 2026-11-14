import { NextResponse } from "next/server";
import { getHaStates } from "@/lib/ha";
import { getJellyfinNowPlaying } from "@/lib/jellyfin";
import { pickNowPlaying } from "@/lib/now-playing";

export const dynamic = "force-dynamic";

/**
 * Public "now playing" pill for the kiosk. Same public-route idiom as
 * /kiosk/api/vitals and /kiosk/api/ha/states — this is intentionally exempt
 * from the session gate (middleware.ts's PUBLIC_PATHS matches "/kiosk", which
 * covers "/kiosk/api/*").
 *
 * Source priority: the Google TV streamer's HA media_player entity wins
 * whenever it's actually playing or paused; Jellyfin (already filtered to
 * ONE configured user — see getJellyfinNowPlaying()) is the fallback, tried
 * only when HA has nothing. Neither source configured, or nothing playing on
 * either, both collapse to the SAME {status:"idle"} — the pill just doesn't
 * render on a wall tablet nobody administers day to day; it never nags about
 * missing config. The pick itself lives in src/lib/now-playing.ts (the desk
 * glance shares it).
 *
 * Sanitize-before-returning, same idiom as /kiosk/api/ha/states stripping
 * locks: only plain title/subtitle/appName strings and numbers cross this
 * boundary. Nothing HA- or Jellyfin-URL-shaped (entity_picture, session ids,
 * device names) ever does — ha.ts's mapMediaPlayer and jellyfin.ts's
 * getJellyfinNowPlaying already keep those out of the shapes the pick reads,
 * so there is nothing further to strip here, but the normalized
 * NowPlayingSnapshot shape is the enforcement: it has no field for them.
 */
export async function GET() {
  return NextResponse.json(await pickNowPlaying(getHaStates, getJellyfinNowPlaying));
}

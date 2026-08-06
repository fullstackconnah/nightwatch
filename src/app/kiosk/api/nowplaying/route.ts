import { NextResponse } from "next/server";
import { getHaStates } from "@/lib/ha";
import { getJellyfinNowPlaying } from "@/lib/jellyfin";
import type { HaMediaPlayer } from "@/lib/ha-types";
import type { NowPlayingActive, NowPlayingSnapshot } from "@/lib/nowplaying-types";

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
 * missing config.
 *
 * Sanitize-before-returning, same idiom as /kiosk/api/ha/states stripping
 * locks: only plain title/subtitle/appName strings and numbers cross this
 * boundary. Nothing HA- or Jellyfin-URL-shaped (entity_picture, session ids,
 * device names) ever does — ha.ts's mapMediaPlayer and jellyfin.ts's
 * getJellyfinNowPlaying already keep those out of the shapes this route reads,
 * so there is nothing further to strip here, but the normalized
 * NowPlayingSnapshot shape below is the enforcement: it has no field for them.
 */

/** Any "playing" candidate wins over any "paused" one; everything else
 *  (idle/off/unavailable/unknown/anything HA invents) is ignored outright.
 *  Sorted by name (buildEntities already sorts mediaPlayers), so ties within
 *  a state resolve the same way every poll — no flicker between two
 *  simultaneously-playing players. */
function bestHaCandidate(players: HaMediaPlayer[]): HaMediaPlayer | null {
  const playing = players.find((p) => p.state === "playing");
  if (playing) return playing;
  return players.find((p) => p.state === "paused") ?? null;
}

function fromHa(player: HaMediaPlayer): NowPlayingActive {
  const progress01 =
    player.mediaDurationS != null && player.mediaPositionS != null && player.mediaDurationS > 0
      ? player.mediaPositionS / player.mediaDurationS
      : undefined;

  return {
    status: "ok",
    source: "ha",
    // Fall back to the entity's own friendly name when HA reports a
    // state (playing/paused) but no media_title — still worth showing
    // something rather than hiding the pill over a missing attribute.
    title: player.mediaTitle ?? player.appName ?? player.name,
    ...(player.mediaSeries ? { subtitle: player.mediaSeries } : {}),
    ...(player.appName ? { appName: player.appName } : {}),
    state: player.state === "paused" ? "paused" : "playing",
    ...(progress01 != null ? { progress01 } : {}),
  };
}

export async function GET() {
  const ha = await getHaStates();
  if (ha.status === "ok" && ha.entities) {
    const candidate = bestHaCandidate(ha.entities.mediaPlayers);
    if (candidate) return NextResponse.json(fromHa(candidate));
  }

  const jf = await getJellyfinNowPlaying();
  if (jf) {
    const snapshot: NowPlayingSnapshot = {
      status: "ok",
      source: "jellyfin",
      title: jf.title,
      ...(jf.series ? { subtitle: jf.series } : {}),
      appName: jf.appName,
      state: jf.paused ? "paused" : "playing",
      ...(jf.progress01 != null ? { progress01: jf.progress01 } : {}),
    };
    return NextResponse.json(snapshot);
  }

  const idle: NowPlayingSnapshot = { status: "idle" };
  return NextResponse.json(idle);
}

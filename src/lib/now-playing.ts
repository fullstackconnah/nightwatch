/* The kiosk's now-playing pick, shared by /kiosk/api/nowplaying and the desk glance.
 * Type-only imports so node:test can load it without the @/ aliases. */
import type { HaMediaPlayer, HaStatesResponse } from "./types/ha.ts";
import type { JellyfinNowPlaying } from "./jellyfin.ts";
import type { NowPlayingActive, NowPlayingSnapshot } from "./types/nowplaying.ts";

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

/** HA first, Jellyfin only when HA has no candidate, else idle. No try/catch: a throw stays a throw, as the kiosk route had it. */
export async function pickNowPlaying(
  getHa: () => Promise<HaStatesResponse>,
  getJf: () => Promise<JellyfinNowPlaying | null>,
): Promise<NowPlayingSnapshot> {
  const ha = await getHa();
  if (ha.status === "ok" && ha.entities) {
    const candidate = bestHaCandidate(ha.entities.mediaPlayers);
    if (candidate) return fromHa(candidate);
  }

  const jf = await getJf();
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
    return snapshot;
  }

  return { status: "idle" };
}

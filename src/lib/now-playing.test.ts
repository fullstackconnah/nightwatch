import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickNowPlaying } from "./now-playing.ts";
import type { HaMediaPlayer, HaStatesResponse } from "./types/ha.ts";
import type { JellyfinNowPlaying } from "./jellyfin.ts";

// Pins the kiosk /kiosk/api/nowplaying response: every case is a deepEqual on the whole object.
const player = (o: Partial<HaMediaPlayer> & { name: string; state: string }): HaMediaPlayer => ({ entityId: "media_player.x", ...o });
const ha = (...mediaPlayers: HaMediaPlayer[]): (() => Promise<HaStatesResponse>) => async () =>
  ({ status: "ok", entities: { mediaPlayers } }) as unknown as HaStatesResponse;
const jf = (v: JellyfinNowPlaying | null) => {
  const f = async () => {
    f.calls++;
    return v;
  };
  f.calls = 0;
  return f;
};

test("HA playing wins over paused and Jellyfin is not asked", async () => {
  const j = jf({ title: "J", appName: "Jellyfin", paused: false });
  const out = await pickNowPlaying(ha(player({ name: "A", state: "paused", mediaTitle: "Paused A" }), player({ name: "B", state: "playing", mediaTitle: "Playing B" })), j);
  assert.deepEqual(out, { status: "ok", source: "ha", title: "Playing B", state: "playing" });
  assert.equal(j.calls, 0);
});

test("HA paused is used when nothing plays", async () => {
  const j = jf(null);
  const out = await pickNowPlaying(ha(player({ name: "A", state: "idle" }), player({ name: "B", state: "paused", mediaTitle: "Held" })), j);
  assert.deepEqual(out, { status: "ok", source: "ha", title: "Held", state: "paused" });
  assert.equal(j.calls, 0);
});

test("HA title falls back to appName, then the entity name; subtitle and appName keys are absent when HA has none", async () => {
  const j = jf(null);
  assert.deepEqual(await pickNowPlaying(ha(player({ name: "Lounge", state: "playing", appName: "Cast", mediaSeries: "Show" })), j), {
    status: "ok", source: "ha", title: "Cast", subtitle: "Show", appName: "Cast", state: "playing",
  });
  assert.deepEqual(await pickNowPlaying(ha(player({ name: "Lounge", state: "playing" })), j), { status: "ok", source: "ha", title: "Lounge", state: "playing" });
});

test("progress01 needs a position and a positive duration", async () => {
  const j = jf(null);
  const one = (extra: Partial<HaMediaPlayer>) => pickNowPlaying(ha(player({ name: "A", state: "playing", mediaTitle: "T", ...extra })), j);
  assert.deepEqual(await one({ mediaPositionS: 30, mediaDurationS: 120 }), { status: "ok", source: "ha", title: "T", state: "playing", progress01: 0.25 });
  assert.deepEqual(await one({ mediaPositionS: 30, mediaDurationS: 0 }), { status: "ok", source: "ha", title: "T", state: "playing" });
  assert.deepEqual(await one({ mediaDurationS: 120 }), { status: "ok", source: "ha", title: "T", state: "playing" });
});

test("HA not ok, or no candidate, falls back to Jellyfin", async () => {
  const down = async () => ({ status: "unreachable" }) as unknown as HaStatesResponse;
  assert.deepEqual(await pickNowPlaying(down, jf({ title: "Ep", series: "Show", appName: "Jellyfin", paused: true, progress01: 0.5 })), {
    status: "ok", source: "jellyfin", title: "Ep", subtitle: "Show", appName: "Jellyfin", state: "paused", progress01: 0.5,
  });
  const j = jf({ title: "Film", appName: "Jellyfin", paused: false });
  assert.deepEqual(await pickNowPlaying(ha(player({ name: "A", state: "off" })), j), { status: "ok", source: "jellyfin", title: "Film", appName: "Jellyfin", state: "playing" });
  assert.equal(j.calls, 1);
});

test("nothing anywhere is idle", async () => {
  assert.deepEqual(await pickNowPlaying(ha(), jf(null)), { status: "idle" });
});

test("the kiosk route only delegates", () => {
  const route = readFileSync(new URL("../app/kiosk/api/nowplaying/route.ts", import.meta.url), "utf8");
  assert.match(route, /NextResponse\.json\(await pickNowPlaying\(getHaStates, getJellyfinNowPlaying\)\)/);
  const exported = [...route.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["GET", "dynamic"]);
  assert.doesNotMatch(route, /bestHaCandidate/);
});

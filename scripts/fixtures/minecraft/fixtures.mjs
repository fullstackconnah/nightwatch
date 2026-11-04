/* Fixtures for scripts/minecraft-shots.mjs: one per row of the pattern spec's section 5 (states). Every address is a
 * placeholder; nothing here names a real host. The browser clock is pinned to NOW, so every age and uptime is exact.
 *
 * A fixture is { status, container, backups, logs }:
 *   status    the /api/minecraft/status body, or "hang" (never answered) or "fail" (HTTP 500)
 *   container the minecraft container's runtime fields, or null for "no container"
 */
export const NOW = Date.parse("2026-10-15T12:00:00+11:00");
const HOUR = 3_600_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const ATM = { slug: "atm10", name: "All the Mods 10", source: "curseforge", packRef: "https://curseforge.example.invalid/atm10", mcVersion: "1.21.1", memoryGb: 6, createdAt: iso(48 * HOUR) };
const PLAIN = { slug: "plain", name: "Plain Fabric", source: "modrinth", packRef: "https://modrinth.example.invalid/plain", mcVersion: "1.21.1", memoryGb: 4, createdAt: iso(96 * HOUR) };

const running = { state: "running", exitCode: null, startedAt: NOW - 3 * HOUR };
const players2 = { online: 2, max: 10, players: ["Alice", "Bob"] };
const okStatus = { manager: "ok", instances: [ATM, PLAIN], active: "atm10", players: players2, rcon: "ok" };

export const BACKUPS = [
  { instance: "atm10", file: "atm10-2026-10-15-0600.tar.gz", sizeBytes: 812_000_000, modifiedAt: iso(6 * HOUR) },
  { instance: "atm10", file: "atm10-2026-10-14-0600.tar.gz", sizeBytes: 805_000_000, modifiedAt: iso(30 * HOUR) },
];

export const LOG_CALM = "[11:58:01] [Server thread/INFO]: Alice joined the game\n[11:59:40] [Server thread/INFO]: Bob joined the game";
export const LOG_CRASH = "[11:40:10] [main/ERROR]: Couldn't download 3 mod files\n[11:40:11] [main/ERROR]: Install failed, exiting";

const base = { container: running, backups: BACKUPS, logs: LOG_CALM };

/** Sample search results: icons are data: URIs so the page never leaves its own origin (C14). */
const ICON = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%23446'/%3E%3C/svg%3E";
export const SEARCH = {
  curseforge: "ok",
  modrinth: "ok",
  results: [
    { source: "modrinth", id: "r1", slug: "better-mc", name: "Better MC", summary: "", icon: ICON, downloads: 120000, mcVersion: "1.21.1", loader: "fabric", pageUrl: "https://modrinth.example.invalid/better-mc" },
    { source: "curseforge", id: "r2", slug: "skyfactory", name: "SkyFactory", summary: "", icon: ICON, downloads: 980000, mcVersion: "1.20.1", loader: "forge", pageUrl: "https://curseforge.example.invalid/skyfactory" },
  ],
};

export const FIXTURES = {
  // Loading: the status call is never answered.
  loading: { ...base, status: "hang" },
  // Unconfigured: no strips.
  unconfigured: { ...base, status: { manager: "unconfigured", instances: [], active: null, players: null, rcon: "unconfigured" }, container: null },
  // Token rejected.
  tokenRejected: { ...base, status: { manager: "unauthorized", instances: [], active: null, players: null, rcon: "unavailable" } },
  // Down: Docker says running, mc-manager does not answer.
  down: { ...base, status: { manager: "unreachable", managerDetail: "connect ECONNREFUSED manager.example.invalid:8090", instances: [], active: null, players: null, rcon: "unavailable" } },
  // Crashed: exit code 1, install failed.
  crashed: { ...base, logs: LOG_CRASH, container: { state: "exited", exitCode: 1, startedAt: NOW - 4 * HOUR }, status: { ...okStatus, players: null, rcon: "unavailable" } },
  // No pack: nothing installed.
  noPack: { ...base, container: { state: "exited", exitCode: 0, startedAt: null }, status: { manager: "ok", instances: [], active: null, players: null, rcon: "unavailable" } },
  // Running, calm.
  calm: { ...base, status: okStatus },
  // Partial: running, the console is not answering.
  partial: { ...base, status: { ...okStatus, players: null, rcon: "unavailable" } },
  // Stale is built by the script: calm, then the status call starts failing.
  calmOne: { ...base, status: { ...okStatus, players: { online: 1, max: 10, players: ["Alice"] } } },
  calmEmpty: { ...base, status: { ...okStatus, players: { online: 0, max: 10, players: [] } } },
  // Stopped (clean exit) and no container: the two stopped rows that are not a crash.
  stopped: { ...base, container: { state: "exited", exitCode: 143, startedAt: NOW - 5 * HOUR }, status: { ...okStatus, players: null, rcon: "unavailable" } },
  noContainer: { ...base, container: null, status: okStatus },
};

/** The players for the hold test: Alice and Bob, then Carol joins. */
export const PLAYERS_AFTER = { online: 3, max: 10, players: ["Alice", "Bob", "Carol"] };

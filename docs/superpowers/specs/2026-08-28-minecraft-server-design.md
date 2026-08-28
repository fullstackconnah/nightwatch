# Minecraft Modded Server + Nightwatch Integration — Design

**Date:** 2026-08-28
**Status:** Approved (owner, 2026-08-28)

## Overview

Run a modded Minecraft server on the home server as a Docker stack, with a
**modpack picker**: browse CurseForge and Modrinth packs from nightwatch,
install one, and switch which pack runs. Nightwatch is the only UI. One pack
runs at a time; each pack keeps its own world, so switching back resumes where
it left off.

## Goals

- Modpack picker in nightwatch: search CurseForge + Modrinth, one-click
  "install & switch".
- Lifecycle controls (start/stop/restart), live status (players online,
  uptime, memory), RCON console, live log tail, world backups
  (scheduled + on-demand + restore).
- Friends join over the internet via playit.gg (free tunnel agent); no port
  forwarding, home IP stays hidden.
- Follow existing nightwatch patterns throughout (IntegrationClient, SWR,
  inline confirms/errors, config.json credentials, middleware auth).

## Non-goals

- Multiple packs running concurrently (16GB host RAM; heap budget ~6GB).
- Public/kiosk exposure — the page is authenticated-dashboard only.
- A general server-management panel (Crafty/Pterodactyl). Rejected: heavy,
  duplicate auth/UI, weaker CurseForge auto-install than itzg's image.
- Widening the docker socket-proxy to allow container create/delete from
  nightwatch. Rejected: blast radius over all containers, and container
  definitions would drift out of compose/Dockge.

## Constraints (verified 2026-08-28)

- Host: 12 cores, 16GB RAM (~9.5GB available; swap 3.6/4GB used), 769GB free
  on /mnt/docker. Default JVM heap 6GB, configurable per instance.
- Nightwatch's socket-proxy allows start/stop/restart/logs but not
  create/remove/exec — pack switching requires container recreation, hence
  the manager service.
- Cloudflare free tunnel is HTTP-only; Minecraft is raw TCP → playit.gg.
- CurseForge API needs a free API key (owner will obtain); Modrinth is
  keyless. Some CF authors opt out of third-party downloads; those packs
  fail auto-install with a clear "add these files manually" error which the
  UI must surface, not hide.

## Architecture

Two deliverables:

1. **Server stack** at `/mnt/docker/stacks/minecraft/` (new small project,
   source in `F:\Projects\personal\minecraft-stack\`, deployed via git
   archive like nightwatch).
2. **Nightwatch feature**: `/minecraft` page + API routes + lib code in the
   existing repo.

### Server stack (`/mnt/docker/stacks/minecraft/`)

```
docker-compose.yml
.env                      # written by mc-manager: ACTIVE_INSTANCE, TYPE, pack ref, MEMORY, RCON password
manager/                  # mc-manager source (FastAPI, single small app)
instances/<slug>/data/    # per-pack world + server files (itzg /data)
instances/<slug>/instance.json  # pack metadata: source, id, name, version, memory, createdAt
backups/<slug>/           # tarballs from mc-backup
```

Services:

- **mc** — `itzg/minecraft-server`. `TYPE=AUTO_CURSEFORGE` (+`CF_API_KEY`,
  `CF_PAGE_URL`) or `TYPE=MODRINTH` (+`MODRINTH_MODPACK`) per active
  instance via `.env`. Mounts `./instances/${ACTIVE_INSTANCE}/data:/data`.
  RCON enabled (port 25575 bound to LAN so the nightwatch container can
  reach it; password in `.env`, generated at setup). `MEMORY=${MC_MEMORY}`.
  `EULA=TRUE`. Exact env names to be confirmed against itzg docs during
  implementation.
- **backup** — `itzg/mc-backup` sidecar; scheduled (daily) tarballs to
  `./backups/<slug>/`, pruned by retention (14 days). On-demand backup =
  manager triggers the same script.
- **playit** — playit.gg agent; one-time claim step at first deploy (owner
  clicks a claim URL; tunnel address then fixed). Forwards public address →
  mc:25565.
- **mc-manager** — FastAPI app, docker socket mounted, bearer-token auth
  (token generated at setup, stored in nightwatch `config.json`). Not
  published beyond LAN. Endpoints:
  - `GET  /health`
  - `GET  /instances` — list instance dirs + metadata + which is active +
    whether mc container is running
  - `POST /instances` — `{slug, name, source: "curseforge"|"modrinth",
    packRef, memoryGb?}` → create dir + instance.json (no start)
  - `POST /instances/{slug}/activate` — compose down, rewrite `.env`,
    compose up mc (first boot of a big pack takes minutes; returns
    immediately, progress watched via logs)
  - `DELETE /instances/{slug}` — refuse if active; deletes world after the
    manager takes a final backup
  - `POST /backups/run` — on-demand backup of active instance
  - `GET  /backups` — list tarballs per instance
  - `POST /backups/{file}/restore` — refuse unless mc stopped; restores into
    the instance's data dir
  The manager shells out to `docker compose` in the stack dir; compose stays
  the source of truth and the stack remains Dockge-visible.

### Nightwatch feature

- **Config** (`src/lib/config.ts`): new `minecraft?: { managerUrl?,
  managerToken?, curseforgeKey?, rconHost?, rconPort?, rconPassword?,
  updatedAt? }` block in `AppConfig`; entered via the existing write-only
  form pattern in Settings → Integrations.
- **Lib**:
  - `src/lib/minecraft/manager.ts` — `McManagerClient extends
    IntegrationClient` (probe → unconfigured/unreachable/unauthorized/ok).
  - `src/lib/minecraft/packs.ts` — pack search: CurseForge
    (`api.curseforge.com`, `x-api-key`, modpack class) and Modrinth
    (`api.modrinth.com/v2/search`, modpack facet). Normalized result shape
    `{source, id, slug, name, summary, icon, downloads, mcVersion, loader,
    pageUrl}`. CF search returns "needs key" state when key absent.
  - `src/lib/minecraft/rcon.ts` — thin wrapper over new dep `rcon-client`;
    used for console commands, `list` (players), and status enrichment.
    Connection per request (no pooling), short timeout, never throws raw.
- **API routes** (auth free via middleware; NOT in PUBLIC_PATHS):
  - `GET  /api/minecraft/status` — merges docker state (existing
    `docker.ts`) + manager instances + RCON `list`
  - `GET  /api/minecraft/packs/search?q=&source=`
  - `POST /api/minecraft/instances` / `POST .../activate` / `DELETE` —
    proxy to manager
  - `POST /api/minecraft/rcon` — `{command}` → response text
  - `GET/POST /api/minecraft/backups...` — proxy to manager
  - Logs and lifecycle: reuse existing `/api/docker/containers/[id]/...`
    routes against the `mc` container — no new backend.
- **UI** — `src/app/(dash)/minecraft/page.tsx`, nav entry in Integrations
  group (`side-nav.tsx`, lucide icon). Panels:
  1. **Status card** — state, active pack, players online, uptime, memory;
     `LifecycleActions`/`ContainerStatus` reused for start/stop/restart.
  2. **Pack browser** — search box + source filter; result rows with icon,
     name, loader/version, downloads; "Install & switch" with the standard
     inline two-step confirm; installed instances listed with
     activate/delete. Active-instance switch warns it stops the current
     world (inline confirm).
  3. **Console** — command input + scrollback of sent/received; disabled
     with hint when server stopped/RCON unconfigured.
  4. **Logs** — reuse the existing container log tail component against the
     `mc` container (covers watching a modpack's slow first boot).
  5. **Backups** — list per instance, "Back up now", restore (only when
     stopped; inline confirm).
  - SWR polling via new hooks in `src/lib/client.ts`
    (`useMinecraftStatus` etc., `refreshInterval` ~5–10s, RCON-backed
    status no faster than 10s). All errors inline, house style. Kiosk
    untouched.

## Error handling

- Manager unreachable/unconfigured → page renders the standard
  "Connect" hatch state (same as smarthome/proxy pattern), everything else
  degrades gracefully (docker-only info still shows).
- CF opt-out packs: activation proceeds, mc container exits with itzg's
  manifest error; status card shows "install failed" with a "view log"
  pointer — the log names the files to add manually to the instance dir.
- RCON down while container up (common during modpack boot): status shows
  "starting — console unavailable", not an error.
- Activate while running: manager performs graceful stop (compose down waits
  on itzg's built-in `stop` handling) before switching.

## Security

- mc-manager: bearer token, LAN-only port binding, no exec surface beyond
  its fixed compose/backup commands; token lives in nightwatch config.json
  (write-only form, never echoed).
- RCON: password from `.env`, port bound to LAN interface only; playit
  forwards ONLY 25565 (game), never RCON or manager.
- Nightwatch routes protected by existing session middleware; nothing added
  to PUBLIC_PATHS.

## Testing

- mc-manager: pytest unit tests (instance CRUD, .env rendering, activate
  ordering, backup/restore guards) with docker/compose shelling mocked.
- Nightwatch: verify on the port-3006 test stack per CLAUDE.md before
  production deploy; manual pass over unconfigured/unreachable states.
- End-to-end: install a small Modrinth pack first (keyless path), then a
  CurseForge pack once the key lands.

## Deployment

1. New stack: archive `minecraft-stack` repo dir → `/mnt/docker/stacks/minecraft/`,
   generate `.env` secrets, `docker compose up -d` (manager + playit only;
   mc starts on first activate). Owner claims playit tunnel via URL.
2. Nightwatch: standard DEPLOY.md flow (test stack 3006 → prod 3005).
3. Owner supplies CurseForge API key in Settings when obtained; Modrinth
   works immediately.

## Open items

- CurseForge API key — owner to obtain (console.curseforge.com); CF search
  shows "needs key" until then.
- playit.gg account claim — one-time interactive step at first deploy.
- Exact itzg env var names + mc-backup on-demand invocation — verify against
  current image docs during implementation.

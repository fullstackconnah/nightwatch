# Nightwatch Expansion — Design (2026-08-01)

Scoping decision record and design for the six features approved from the
full ideas list. Decisions confirmed by the owner on 2026-08-01:

- **Monorepo split (Turborepo): deferred.** Kiosk/ambient mode ships as a
  route in this app; it ports to `apps/kiosk` later if it ever diverges.
- **Forgejo: install now** as a new Dockge-style stack (port 3010).
- **HA + NPM integrations: build now** with graceful "not configured"
  states; the owner adds credentials to `data/config.json` when ready.
- **Deferred to their own projects:** Hermes agent suite (§9, §11b), voice
  pipeline (§10), OIDC/Authelia (§5b), cameras/go2rtc/doorbell (§7 —
  hardware not installed), iPad wall-mount power sync (§6a — physical).

Server facts that shaped scope: socket-proxy already grants
`POST=1 IMAGES=1 VOLUMES=1 CONTAINERS=1 SYSTEM=1` (image/volume prune needs
no new scopes; **build-cache prune is out** — `BUILD=0` stays), HA and
nginx-proxy-manager are running, Forgejo/Authelia/go2rtc/Ollama are not.

Shared scaffold (done up front so features stay disjoint): `AppConfig` keys
`homeassistant`, `npm`, `forgejo`, `github`; NAV entries `/smarthome`,
`/proxy`, `/git`; `/kiosk` sidebar footer link; mobile tab bar converted
from `grid-cols-8` to a scrollable snap rail.

---

## 1. Disk reclaimer (extends /images and /volumes)

**Purpose:** show estimated reclaimable space and prune it safely.

- **Data:** `GET /system/df` (scope already approved) via a new
  `src/app/api/docker/disk-usage` route → dangling/unused images, unused
  (orphan) volumes, build cache size. Build cache renders **read-only**
  with a note that pruning it would need `BUILD=1`.
- **Actions:** `POST /api/docker/prune` with `{ target: "images" | "volumes" }`
  (dockerode `pruneImages({ dangling })` / `pruneVolumes`). Admin session
  required (same auth as lifecycle actions). Response reports space
  actually reclaimed and items deleted.
- **UI:** a "Reclaimable" panel on `/images` (dangling image list, per-item
  size, prune button with an explicit inline confirm step — danger styling
  per DESIGN.md button-danger tint) and an "orphan" marker + prune panel on
  `/volumes`. Empty state = "nothing to reclaim" as real copy.
- **Out:** container pruning (too dangerous), build-cache prune, scheduled
  auto-prune.

## 2. Kiosk ambient mode + PIN elevation (/kiosk)

**Purpose:** wall-tablet ambient display with PIN-gated admin elevation.

- `/kiosk` is a standalone full-screen route (own layout, no side nav):
  large clock, host vitals summary, container health counts, and an
  unhealthy-attention strip. (Weather/doorbell/HA tiles join later once
  those integrations mature.)
- "Admin" tap → 4-digit PIN pad (nightwatch-styled, mono figures, accent
  focus; PIN comes from settings or the `KIOSK_PIN` env, with no built-in
  default — an unconfigured install refuses elevation). Correct PIN
  mints a short-lived elevated cookie (jose JWT, 5-minute expiry, sliding
  on activity); idle or expiry drops back to ambient. Elevation reveals
  lifecycle controls / links into the full dashboard.
- Middleware: `/kiosk` is viewable **without** the admin login session
  (ambient panels are public-on-LAN by deliberate choice; they expose only
  vitals/counts, no logs/secrets). Elevated actions reuse existing
  authenticated APIs — the PIN cookie upgrades to a real session
  server-side. Rate-limit PIN attempts (per-IP backoff).
- **Out:** OIDC, per-user roles, doorbell/video tiles.

## 3. Nightwatch MCP server (/api/mcp)

**Purpose:** expose nightwatch's data to MCP clients (Claude etc.).

- Hand-rolled minimal **Streamable HTTP** MCP endpoint (JSON-RPC 2.0 POST;
  no SDK — PRODUCT.md forbids casual runtime deps). Implements
  `initialize`, `resources/list`, `resources/read`, `tools/list`,
  `tools/call`.
- **Resources:** `nightwatch://containers` (list+state),
  `nightwatch://logs/{container}` (recent tail),
  `nightwatch://smart` (drive health), `nightwatch://telemetry` (host
  vitals). **Tools:** `container_start|stop|restart` (reuse docker lib).
- **Auth:** `Authorization: Bearer ${MCP_TOKEN}` (env; 401 otherwise;
  disabled entirely when env is unset). Documented in README with a
  claude-code `mcp add` example.
- **Out:** SSE server-push, subscriptions, prompts.

## 4. Home Assistant entity panel (/smarthome)

**Purpose:** mirror + control HA lights/switches/climate/locks/sensors.

- **Server:** `src/lib/ha.ts` talks to HA's REST API
  (`config.homeassistant.{url,token}`): `GET /api/states`,
  `POST /api/services/{domain}/{service}`. Polling (client hook, ~3s on
  the page) rather than a WS bridge — no new deps, and the dashboard's
  established pattern is poll-based. (A native `WebSocket` bridge is a
  documented future upgrade.)
- **UI:** domain-grouped entity panels (lights, switches, climate, locks,
  sensors), 44px touch toggles with optimistic state + reconcile-on-poll,
  lock actions behind a hold-to-confirm. Unconfigured state = setup copy
  explaining the token mint + config.json snippet. Unreachable HA = error
  state distinct from "no entities".
- **Out:** bidirectional WS push, HA automations editing, camera entities.

## 5. Reverse-proxy route map (/proxy)

**Purpose:** visualize nginx-proxy-manager: domain → target routes, cert
expiry, upstream health.

- **Server:** `src/lib/npm.ts` authenticates against NPM's admin API
  (`config.npm.{url,email,password}` → `POST /api/tokens`, cached token,
  re-auth on 401): proxy hosts, redirections, certificates. Health: for
  each proxy host, server-side `HEAD`/`GET` to the forward target with a
  short timeout → up / degraded / down.
- **UI:** route map table (domain, target, SSL badge with days-to-expiry —
  warn <30d, bad <7d per the Threshold Rule), health dots, link-out to NPM
  admin. Unconfigured + unreachable states as real copy. Read-only v1
  (no route editing — NPM's own UI does that; link out, Dockge-style).
- **Out:** editing routes/certs, raw nginx config management.

## 6. Forgejo commit stream + GitHub sync (/git)

**Purpose:** self-hosted git visibility: recent commits across repos,
branches, PRs, and local→GitHub mirror sync status.

- **Infra:** Forgejo stack at `/mnt/docker/stacks/forgejo`
  (`codeberg.org/forgejo/forgejo`, port 3010 HTTP / 2222 SSH, named
  volume). Owner creates the admin account + API token afterwards.
- **Server:** `src/lib/forgejo.ts` (`config.forgejo.{url,token}`): repo
  list, recent commits per repo (merged into one stream), branches, open
  PRs. Sync visualizer: Forgejo push-mirror status per repo
  (`/repos/{owner}/{repo}/push_mirrors`) with last-sync age + error state;
  optional `config.github.token` compares branch heads for divergence
  ("ahead/behind" vs the mirror). Force-sync button →
  `POST /push_mirrors-sync` (admin session required).
- **UI:** commit stream (relative time, repo chip, message, author, link
  into Forgejo diff), branch/PR panel, mirror-sync panel with divergence
  badges. Unconfigured / empty-instance ("no repos yet") states.
- **Out:** repo browsing, code review UI, webhooks.

---

## Cross-cutting rules (all features)

- Follow CLAUDE.md, PRODUCT.md, DESIGN.md exactly: no new runtime deps,
  tokens only (no raw hex), mono-is-data, microlabels, hatch-not-empty,
  44px touch, table-or-cards, `hidden md:table` + `md:hidden` cards,
  threshold-earned state colour, one authored motion per surface behind
  `prefers-reduced-motion`.
- Every surface ships real empty / loading / error / unconfigured /
  offline states; 1440px and 390px both verified, zero horizontal overflow.
- Server does all fetching; secrets never reach the client; new secrets
  live in `data/config.json` (never git) or server-side env.
- Gate: `npx tsc --noEmit && npm run build`, then test-stack (port 3006)
  browser verification before anything is called done.

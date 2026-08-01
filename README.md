# homelab-dashboard · nightwatch

Self-hosted single-pane-of-glass for the homelab (192.168.1.70). Replaces
gethomepage/homepage: host vitals + every Docker container auto-discovered,
live per-service widget data, container start/stop/restart/create from the UI.

Next.js (App Router, TS) · Tailwind v4 · dockerode via a scoped
`tecnativa/docker-socket-proxy` · `systeminformation` + `/host/proc` for host
vitals. Dark-first "night console" identity.

## Pages

- **Overview** — CPU/mem/disk/net/uptime/temp vitals, health counts, and a
  grouped tile grid of every container with live widget data (Sonarr, Radarr,
  Prowlarr, Bazarr, qBittorrent, Pi-hole v6, Seerr, Glances built in).
- **Containers** — filterable table, start/stop/restart, "New container" form
  (pull + create + start one-offs; compose stacks stay in Dockge — the nav
  links out to it).
- **Container detail** — live CPU/mem/net graphs (3 s Docker stats polling),
  log tail (pause/tail-size), metadata (ports, mounts, env behind a reveal
  toggle, compose stack, restart count), actions, open-app link.
- **Images / Volumes / Networks** — inventory with in-use/orphan flags.
- **Settings** — widget CRUD (built-in types + generic JSON-path), per-container
  group/URL/icon/hide overrides, label-convention + socket-proxy reference.

## Auto-discovery & labels

Every container shows up with zero config (5 s poll). Groups default to the
compose project; URLs are inferred from published ports. Opt-in overrides via
labels (namespaced so Homepage's `homepage.*` can coexist):

```yaml
labels:
  - dashboard.enable=false          # hide tile
  - dashboard.url=http://…          # open-app link
  - dashboard.icon=jellyfin         # selfh.st slug or full URL
  - dashboard.group=Media
  - dashboard.widget.type=generic
  - dashboard.widget.endpoint=http://…/api/stats
  - dashboard.widget.path=Queries:queries.total,Hits:cache.hits
  - dashboard.widget.key=<api key>
```

Widget instances with secrets (API keys) live in `data/config.json`
(gitignored, volume-mounted in prod) — editable from Settings.

## Local dev

```sh
npm install
# tunnel the homelab docker socket (keep running):
ssh -N -L 127.0.0.1:12375:/var/run/docker.sock homelab@192.168.1.70
npm run dev            # http://localhost:3005 — any password logs in (dev only)
```

`.env.local` already points `DOCKER_HOST` at the tunnel. Host vitals in dev
show the dev machine; in the container they read the host via `/host/proc`,
`/host/sys`, `/host/rootfs` mounts. The qBittorrent widget only works from the
server itself (its WebUI whitelists `172.16.0.0/12` — container requests
bypass auth; LAN requests need the real password).

## Auth

Two layers, both required for exposure beyond the LAN:

1. NPM access list in front of the app.
2. Built-in login: `npm run hash-password -- 'your-password'` → set
   `ADMIN_PASSWORD_HASH` (+ a random `SESSION_SECRET`) in the `.env` next to
   `docker-compose.yml`. Without a hash, production login is disabled
   (dev mode accepts anything).

Session = 7-day HttpOnly JWT cookie; middleware guards every page and API
route. The socket proxy never exposes `EXEC`, so the app cannot shell into
containers even if compromised.

## MCP server

`/api/mcp` exposes nightwatch's data to MCP clients (Claude Code, Claude
Desktop, etc.) over the Streamable HTTP transport — hand-rolled JSON-RPC 2.0,
no SDK. Deployed: `http://192.168.1.70:3005/api/mcp`.

Resources: `nightwatch://containers`, `nightwatch://telemetry`,
`nightwatch://smart`, `nightwatch://logs/{container}` (last ~200 lines, by
name). Tools: `container_start` / `container_stop` / `container_restart`
(each `{ name: string }`), reusing the same lifecycle actions as the
Containers page.

Disabled by default — set `MCP_TOKEN` (a long random string) in the server's
`.env` to turn it on; every request must send it as
`Authorization: Bearer <token>`, checked independently of the cookie session
above. Unset `MCP_TOKEN` → the endpoint always returns 503.

```sh
claude mcp add --transport http nightwatch http://192.168.1.70:3005/api/mcp \
  --header "Authorization: Bearer <token>"
```

## Deploy

See [DEPLOY.md](DEPLOY.md) — Dockge stack at
`/mnt/docker/stacks/homelab-dashboard`, port **3005** until Homepage (3001) is
decommissioned.

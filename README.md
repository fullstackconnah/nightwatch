# homelab-dashboard · nightwatch

Self-hosted single-pane-of-glass for the homelab (homelab.local). Replaced
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

The `vikunja` widget type shows task counts: each field's path is a Vikunja
filter (e.g. `done = false`), and the key is a Vikunja API token with read
access to tasks. Fields are written to the config, not edited in Settings.

## Local dev

```sh
npm install
# tunnel the homelab docker socket (keep running):
ssh -N -L 127.0.0.1:12375:/var/run/docker.sock homelab@homelab.local
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
   `ADMIN_PASSWORD_HASH` and a long random `SESSION_SECRET` (required: without
   it production login answers 503) in the `.env` next to
   `docker-compose.yml`. Without a hash, production login is disabled
   (dev mode accepts anything).

Session = 7-day HttpOnly JWT cookie; middleware guards every page and API
route. The socket proxy never exposes `EXEC`, so the app cannot shell into
containers even if compromised. Changing the password in Settings signs out
every other login session (the browser that changed it stays signed in). A wall kiosk
unlocked with its PIN stays unlocked until that unlock lapses, and the MCP token is not changed.
The password set in Settings replaces the one in `.env`: once it is stored, only
it signs in, and `ADMIN_PASSWORD_HASH` counts only until then (first setup).
Forgotten it? On the server, remove `system.adminPasswordHash` from the stored
config file; the `.env` password signs in again, and you can set a new one.

The session, kiosk-unlock and SSO-flow cookies are marked `Secure` when the
request reaches the app over https through the proxy (`X-Forwarded-Proto:
https`) and stay non-secure on plain-HTTP LAN access. A browser will not
overwrite or clear a `Secure` cookie over http, so do not serve one hostname
over both: sign-in over http would loop back to the login page and sign-out
over http would not clear the cookie. Use the LAN address for http, a separate
name for https, and force https on that name at the proxy.

### Single sign-on (OIDC)

`OIDC_ALLOWED_USERS` (or the `oidcAllowedUsers` system setting in
`data/config.json`, which wins unless it holds no entries) lists who may sign in through SSO: entries
separated by commas or spaces, each either an account `sub` (recommended, it
is an opaque id that never changes; match is exact) or an email (matched
without regard to case, and only when the provider marks it verified). Unset
or blank means any account the provider authenticates gets an owner session,
and the server log says so once. A refused login is logged with its `sub`.

To find your `sub`: set the list to a throwaway value such as `placeholder`,
sign in through SSO (it is refused), copy the `sub` from the server log line
`OIDC login refused: sub "..."`, then replace the throwaway value with it.
The list is never shown in Settings or sent to the browser, and saving Settings
keeps it. Password sign-in is unaffected by the list.

## MCP server

`/api/mcp` exposes nightwatch's data to MCP clients (Claude Code, Claude
Desktop, etc.) over the Streamable HTTP transport — hand-rolled JSON-RPC 2.0,
no SDK. Deployed: `http://homelab.local:3005/api/mcp`.

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
claude mcp add --transport http nightwatch http://homelab.local:3005/api/mcp \
  --header "Authorization: Bearer <token>"
```

## Deploy

See [DEPLOY.md](DEPLOY.md) — Dockge stack at
`/mnt/docker/stacks/homelab-dashboard`, port **3005**. It is the only dashboard: Homepage (3001) was
retired on 2026-11-12.

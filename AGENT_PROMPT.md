# Agent Prompt: Homelab Dashboard

Paste everything below the line into a fresh Claude Code session (or any capable coding agent) to build this project from scratch.

---

<context>
You are building a new project called **homelab-dashboard**, a self-hosted, single-pane-of-glass control panel for a home server running Docker.

**Server facts:**
- Host: `192.168.1.70`, reachable via `ssh homelab@192.168.1.70` (key auth already configured).
- Existing stacks are managed with **Dockge** and follow the pattern documented for the "vaultview" project: each stack lives under `/mnt/docker/stacks/<name>`, is synced via `git archive` (not a live git clone — CRLF from `git archive` means diffing against `git show HEAD:<file>` will show false mismatches; verify content, not hashes), runs on its own port, and sits behind an **Nginx Proxy Manager (NPM)** reverse proxy.
- There is currently a **gethomepage/homepage** dashboard running in Docker on port `3001`. This new project **replaces it** — feature parity with Homepage's "auto-discovered service tiles with live widget data" is the baseline bar, not a stretch goal.
- No dedicated system-metrics exporter (e.g. Prometheus/node_exporter) exists yet on the host. Do not assume one — read metrics directly (see Architecture).
</context>

<task>
Design and implement homelab-dashboard: a Next.js web app that gives a full view of the home server (host vitals + every Docker container), auto-discovers new containers as they're deployed, pulls live stats from each container's own API where available, and lets the user open, start/stop/restart, and create containers directly from the UI.
</task>

<requirements>
1. **Home page** — one screen with everything: host vitals (CPU/RAM/disk/network/uptime/temp if available), a summary of container health (running/stopped/restarting/unhealthy counts), and a widget grid of every discovered container's live data (mirrors what Homepage showed today).
2. **Side nav** (left edge, persistent) with at minimum: Overview, Containers, Images, Volumes, Networks, Settings. Settings is where the user edits/maintains dashboard config (label conventions, integrations, socket-proxy scopes reference, auth).
3. **Auto-discovery** — poll the Docker Engine API on an interval; every container that appears must show up with zero manual config. Use container **labels** as the opt-in convention for extra behavior (see Architecture) — this mirrors how Homepage itself already reads `homepage.*` labels, so existing compose files may already carry some of this metadata.
4. **Container detail view** — clicking a container opens a page with: live CPU/mem/network graphs (from Docker stats API), recent log tail, compose project grouping, key metadata (image, created, restart count, ports, mounts), and actions: **open app URL** (new tab), start/stop/restart, view full logs.
5. **Per-container widget data** — for containers that expose a stats/metrics HTTP API (the "widget API" pattern Homepage uses — e.g. a service's own `/api/...` health/stats endpoint), fetch and render that data on both the home page tile and the detail page. Build this as a small plugin system: a widget definition = `{ match: labelOrImagePattern, endpoint, path/jsonpath into response, display }`. Ship a handful of built-in widget definitions for whatever's actually running on this host today (introspect via SSH during build — don't guess), plus a generic "JSON path from a URL" widget type so unknown services can be wired up from the Settings page without a code change.
6. **Add / manage containers** — a form to create+start a new container (image, tag, ports, volumes, env vars, network) via the Docker API, for one-off containers. For compose-based stacks, don't reimplement Dockge — link out to the existing Dockge UI instead of rebuilding stack management.
7. **Creative but intuitive UI** — this is a personal tool the user will look at daily; avoid a generic admin-template look. Use shadcn/ui + Tailwind as the component base, but commit to a distinct visual identity (not default shadcn slate-gray). Dark mode is the primary target (this is a homelab tool checked at night).
</requirements>

<architecture>
- **Stack:** Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui. API routes handle all Docker/host communication server-side — never expose Docker control to the client directly.
- **Docker access:** Deploy a `tecnativa/docker-socket-proxy` container alongside the dashboard, bind-mounted to the host's `docker.sock`. The Next.js app talks to the proxy over the internal Docker network (e.g. `http://socket-proxy:2375`) using `dockerode`. Scope the proxy explicitly:
  - Read: `CONTAINERS=1 IMAGES=1 INFO=1 NETWORKS=1 VOLUMES=1 PING=1`
  - Write (only what's needed for start/stop/restart/create): `POST=1` combined with narrowed `ALLOW_START=1 ALLOW_STOP=1 ALLOW_RESTARTS=1`
  - Never enable `EXEC=1` or full unscoped `POST` — the app should not be able to exec into arbitrary containers.
- **Label convention** for auto-discovery/config (namespace it distinctly from Homepage's `homepage.*` so both can theoretically coexist during migration):
  - `dashboard.enable=true` — opt a container into a dashboard tile (default: show everything, this label only overrides visibility)
  - `dashboard.url=` — the app URL to open on click
  - `dashboard.icon=` — icon name/URL
  - `dashboard.group=` — home page section grouping
  - `dashboard.widget.type=` / `dashboard.widget.endpoint=` / `dashboard.widget.path=` — wires the generic widget plugin described in requirement 5
- **Host metrics:** run the dashboard container with `/proc`, `/sys` read-only bind mounts (standard pattern used by tools like Glances/netdata) and read them with the `systeminformation` npm package rather than requiring a separate exporter.
- **Auth:** this app can start/stop/create containers — it must sit behind NPM with an access list AND have its own minimal login (single admin password via env var, hashed, session cookie). Do not ship it reachable without at least one auth layer.
</architecture>

<phases>
Build in this order and get each one actually running before moving on — don't build all layers simultaneously:
1. Scaffold Next.js + Tailwind + shadcn/ui; stub side nav and page routes.
2. Wire up `docker-socket-proxy` + `dockerode`; render a live, auto-discovered container list (name, image, state) with zero widget data yet. Verify against the real host over SSH.
3. Add host vitals via `systeminformation`. Ship the home page layout (vitals + container summary).
4. Add container detail page: stats graphs, logs, start/stop/restart actions.
5. Add the widget plugin system + 2-3 real built-in widgets for whatever's actually running on the host (introspect first, don't guess which services exist).
6. Add create-container form.
7. Add app-level auth.
8. Polish visual identity (this is the "creative UI" pass — do it last, after the data layer works, so design decisions are grounded in real content).
</phases>

<non_goals>
- Do not reimplement Dockge's compose-stack editing — link out to it.
- Do not build a full Prometheus/Grafana-style metrics pipeline — this is a live-status dashboard, not a historical metrics store.
- Do not attempt to migrate every widget integration Homepage supports on day one — ship the generic JSON-path widget type plus real integrations for what's actually deployed, and leave the rest as a documented extension point.
</non_goals>

<deliverables>
- A working repo at `F:\Projects\personal\homelab-dashboard` with a README covering local dev setup.
- A `docker-compose.yml` (dashboard + socket-proxy services) ready for Dockge, following the same deploy pattern as the vaultview stack: its own port (build/test on a temporary port like `3005`; do not claim `3001` until Homepage is actually decommissioned), synced to `/mnt/docker/stacks/homelab-dashboard` via `git archive`.
- A short deploy runbook (mirror the vaultview runbook's format: sync method, first-boot gotchas, rollback approach).
</deliverables>

<thinking_instructions>
Before writing code, introspect the actual host over SSH (container list, labels already in use, what "widget APIs" realistically exist today) rather than assuming — the requirements above describe the shape of the system, not a guess at what's currently deployed.
</thinking_instructions>

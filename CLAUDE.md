# homelab-dashboard (nightwatch)

Single-pane dashboard for the home server (192.168.1.70). Deployed as a Dockge
stack on port 3005. See README.md (features/labels) and DEPLOY.md (runbook).

## Dev

- Docker access: `ssh -N -L 127.0.0.1:12375:/var/run/docker.sock homelab@192.168.1.70` (`.env.local` points DOCKER_HOST at it), then `npm run dev` → http://localhost:3005; any password logs in (dev only)
- **NEVER run `npm run build` while the dev server is running** — they share `.next`; chunks 404 and hydration silently dies
- Killing the dev server on Windows can orphan the node child holding port 3005 — `netstat -ano | grep 3005` then `taskkill //F //PID <pid>`

## Gotchas

- `data/config.json` holds real API keys (gitignored) — ship via scp, never git; server copy must stay `chown 1000:1000`
- qBittorrent widget only returns data from the server itself (WebUI whitelists 172.16.0.0/12; the old LAN password is stale) — dev shows "login failed", prod works
- `ADMIN_PASSWORD_HASH` lives in the server-side `.env` only; bcrypt `$` must never be inlined in docker-compose.yml (compose interpolation mangles it)
- `git archive` from this Windows checkout emits CRLF — verify server files by content, not hash diffs

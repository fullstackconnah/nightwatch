# homelab-dashboard (nightwatch)

Single-pane dashboard for the home server (192.168.1.70). Deployed as a Dockge
stack on port 3005. See README.md (features/labels) and DEPLOY.md (runbook).

## Dev

- Docker access: `ssh -N -L 127.0.0.1:12375:/var/run/docker.sock homelab@192.168.1.70` (`.env.local` points DOCKER_HOST at it), then `npm run dev` → http://localhost:3005; any password logs in (dev only)
- **NEVER run `npm run build` while the dev server is running** — they share `.next`; chunks 404 and hydration silently dies
- Killing the dev server on Windows can orphan the node child holding port 3005 — `netstat -ano | grep 3005` then `taskkill //F //PID <pid>`

## Verify before calling work done

Deploy finished work to the **test stack** and exercise it there. It runs the same
source against the real Docker socket, so it catches what a tunnelled dev server
cannot. Never test against production (3005).

```sh
# ship the working tree (no commit needed) → build → run, on port 3006
tar -cf - --exclude=.git --exclude=node_modules --exclude=.next --exclude=data \
    --exclude='.env*' --exclude=.impeccable --exclude=tsconfig.tsbuildinfo . \
  | ssh server "sudo mkdir -p /mnt/docker/stacks/homelab-dashboard-test \
      && sudo tar -xf - -C /mnt/docker/stacks/homelab-dashboard-test"
ssh server "cd /mnt/docker/stacks/homelab-dashboard-test \
  && sudo docker compose -f docker-compose.test.yml build \
  && sudo docker compose -f docker-compose.test.yml up -d"
ssh server "cd /mnt/docker/stacks/homelab-dashboard-test \
  && sudo docker compose -f docker-compose.test.yml down"   # when finished
```

- **Always pass `-f docker-compose.test.yml`.** The tar also ships the production
  `docker-compose.yml` into that directory; a bare `docker compose` there would claim
  `container_name: homelab-dashboard` and port 3005 and collide with production.
- The stack builds from `Dockerfile.dev` (`next dev`) with **no `.env`** — the only way
  to get a passwordless instance. The login bypass needs `NODE_ENV === "development"`,
  and Next **inlines NODE_ENV at build time**, so setting it at runtime on the
  production standalone image does nothing (verified: the route still refuses login).
- It is **unauthenticated on the LAN and serves every container's log** — gluetun
  credentials, cloudflared tokens, *arr API keys. Keep its socket-proxy `POST=0`/`EXEC=0`
  and `restart: "no"`, and tear it down when finished.
- Walk **every state**, not the happy path: empty, loading, error, offline, long/short
  text, and the 6-track limit. Check at **1440 and 390 px**, assert **0 horizontal
  overflow**, and measure contrast on anything new — `--color-ink-faint` is **2.9:1** and
  fails WCAG AA for body text, so new copy generally wants `ink-dim` (6.5:1).
- To reach states the host will not produce on its own, use a **throwaway container**
  (`alpine`, `--label dashboard.enable=false`) rather than stopping a real service —
  it gives you `live`/`ended`/`error` and burst traffic on demand. Remove it after.
- The test stack's own `homelab-dashboard-test-proxy` can be stopped to force
  socket failures without touching production.

## Browser checks

- Playwright is deliberately **not** a dependency (PRODUCT.md forbids new runtime deps).
  Reuse the sibling install instead:
  `createRequire("F:/Projects/work/SlotCoordination-TestAutomation/package.json")("playwright")`
  with `chromium.launch({ channel: "chrome" })` (system Chrome, no browser download).
- **Never `waitUntil: "networkidle"` on `/logs`** — it holds an open SSE stream, so the
  network is never idle and the call times out. Use `"domcontentloaded"`.
- The login form needs a non-empty password even in dev; any character works.
- `?_rsc=` / `ERR_ABORTED` console noise on navigation is Next.js cancelling `<Link>`
  prefetches — not an app error.

## Quality gate

No ESLint config (`npm run lint` drops into an interactive setup prompt) and no test
runner anywhere in the repo. `npx tsc --noEmit && npm run build` is the only automated
gate — everything else is browser-verified on the test stack.

## Gotchas

- `data/config.json` holds real API keys (gitignored) — ship via scp, never git; server copy must stay `chown 1000:1000`
- qBittorrent widget only returns data from the server itself (WebUI whitelists 172.16.0.0/12; the old LAN password is stale) — dev shows "login failed", prod works
- `ADMIN_PASSWORD_HASH` lives in the server-side `.env` only; bcrypt `$` must never be inlined in docker-compose.yml (compose interpolation mangles it)
- `git archive` from this Windows checkout emits CRLF — verify server files by content, not hash diffs
- Every `git` command here needs `-c safe.directory=F:/Projects/personal/homelab-dashboard` — the working copy is owned by a different Windows SID, so a bare `git status` aborts on "dubious ownership"
- A stray NUL byte in a `.ts` file makes git classify the whole source as binary (no diffs, no blame) — write separators as `\u0000` escapes, never as literal bytes
- `/logs` archives to IndexedDB keyed by line **content**, never by `LogLine.id`: that id is a per-demuxer counter that restarts at 0 on every attach, so the same string names a different physical line after each reload

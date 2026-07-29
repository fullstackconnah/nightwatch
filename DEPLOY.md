# Deploy runbook — homelab-dashboard

Same pattern as the vaultview stack: source synced to
`/mnt/docker/stacks/homelab-dashboard`, built on the server, managed by Dockge.

## Sync method

```sh
# from the repo root (Windows) — git archive of HEAD, extracted on the server
git archive --format=tar HEAD | ssh homelab@192.168.1.70 \
  "sudo mkdir -p /mnt/docker/stacks/homelab-dashboard && sudo tar -xf - -C /mnt/docker/stacks/homelab-dashboard"
```

> ⚠️ `git archive` from this Windows checkout emits CRLF line endings, so
> `diff <(git show HEAD:file)` against the server copy will show false
> mismatches. Verify **content**, not hashes/whitespace.

## First boot (one-time)

1. **Secrets env** — on the server, create `/mnt/docker/stacks/homelab-dashboard/.env`:

   ```sh
   # generate locally: npm run hash-password -- 'your-password'
   # then DOUBLE every '$' before pasting (see below)
   ADMIN_PASSWORD_HASH=$$2b$$12$$…
   SESSION_SECRET=<long random string>
   ```

   **Escape every `$` as `$$`.** Compose expands `$` sequences while parsing
   `.env`, so a raw bcrypt hash arrives at the container truncated (60 chars →
   38) and *every login fails even with the correct password* — with no error
   in the logs, because a short hash is simply a hash that never matches.
   This bit us on 2026-07-30. It applies whether the value is referenced via
   `env_file` or `${...}` in `environment:`; the mangling is in the dotenv layer.

   Escape an already-pasted raw hash in place:

   ```sh
   sudo sed -i.bak '/^ADMIN_PASSWORD_HASH=/ s/\$/$$/g' .env
   ```

   Verify the container actually received all 60 characters:

   ```sh
   sudo docker exec --user node homelab-dashboard \
     sh -c 'printf %s "$ADMIN_PASSWORD_HASH" | wc -c'   # must print 60
   ```

   A `.env` edit does NOT reach a running container — recreate it:
   `sudo docker compose up -d --force-recreate dashboard`

2. **Widget config** — `data/config.json` is gitignored (holds API keys).
   Ship it out-of-band:

   ```sh
   scp data/config.json homelab@192.168.1.70:/tmp/hd-config.json
   ssh homelab@192.168.1.70 "sudo mkdir -p /mnt/docker/stacks/homelab-dashboard/data \
     && sudo mv /tmp/hd-config.json /mnt/docker/stacks/homelab-dashboard/data/config.json \
     && sudo chown -R 1000:1000 /mnt/docker/stacks/homelab-dashboard/data"
   ```

   (uid 1000 = the `node` user in the container; the data dir must stay
   writable or Settings saves will fail.)

3. **Build & start**:

   ```sh
   ssh homelab@192.168.1.70 "cd /mnt/docker/stacks/homelab-dashboard \
     && sudo docker compose build && sudo docker compose up -d"
   ```

4. Open http://192.168.1.70:3005 — log in with the admin password. Add an NPM
   access-list-protected proxy host if exposing beyond the LAN.

## Updates

```sh
git archive --format=tar HEAD | ssh homelab@192.168.1.70 \
  "sudo tar -xf - -C /mnt/docker/stacks/homelab-dashboard"
ssh homelab@192.168.1.70 "cd /mnt/docker/stacks/homelab-dashboard \
  && sudo docker compose build && sudo docker compose up -d"
```

`.env` and `data/` are never in the archive, so updates don't clobber them.

## Gotchas

- **Port**: 3005 until Homepage is actually decommissioned; only then edit the
  compose port mapping to `3001:3000` and stop/remove the `homepage` container.
- **Login disabled?** `ADMIN_PASSWORD_HASH` missing/empty in `.env` — production
  refuses all logins rather than running open.
- **qBittorrent widget** works only in prod (its WebUI whitelists the docker
  subnet; auth is bypassed from the container, and the old admin password no
  longer works from the LAN).
- **Icons** load client-side from jsdelivr (selfh.st pack); with no internet the
  tiles fall back to letter monograms — harmless.
- **Socket proxy scopes**: `EXEC` stays 0. Creating containers needs
  `POST=1` + `IMAGES=1` (pull) + `CONTAINERS=1` — all already set in compose.
- The stack shows up in Dockge automatically (it lives under
  `/mnt/docker/stacks/`); use Dockge for compose edits, this app for one-off
  containers.

## Rollback

```sh
# previous commit → re-archive and rebuild
git archive --format=tar HEAD~1 | ssh homelab@192.168.1.70 \
  "sudo tar -xf - -C /mnt/docker/stacks/homelab-dashboard"
ssh homelab@192.168.1.70 "cd /mnt/docker/stacks/homelab-dashboard \
  && sudo docker compose build && sudo docker compose up -d"
# nuclear: sudo docker compose down (Homepage on 3001 is untouched either way)
```

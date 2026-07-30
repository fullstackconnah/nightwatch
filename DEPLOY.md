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

## GPU telemetry (`/gpu` route)

Enabled 2026-07-30. The `dashboard` service runs under `runtime: nvidia` with
`NVIDIA_DRIVER_CAPABILITIES=utility`, which grants `nvidia-smi`/NVML only — no
CUDA and no video encode, since the page only reads counters. This needs no
extra Docker socket-proxy scope: the collector spawns `nvidia-smi` inside this
container rather than exec-ing into another, so `EXEC` stays `0`.

Two hard requirements, both learned the hard way:

- **The image base must be glibc** (`node:22-slim`, not `-alpine`). The
  container toolkit injects the *host's* `nvidia-smi`, which is glibc-linked; on
  musl it fails with `exec /usr/bin/nvidia-smi: no such file or directory`.
- **The loaded kernel module must match the userspace libraries.** An in-place
  driver upgrade without a reboot breaks everything, including container
  creation, because the toolkit's CDI generator itself calls NVML.

### If GPU telemetry stops working

1. `nvidia-smi` on the host. `Failed to initialize NVML: Driver/library version
   mismatch` means the driver was upgraded without a reboot. Confirm with:

   ```sh
   cat /proc/driver/nvidia/version            # loaded module
   ls /usr/lib/x86_64-linux-gnu/libnvidia-ml.so.*   # installed libs
   ```

   If they disagree, `sudo reboot`. Nothing else fixes it — the running module
   cannot be swapped while the GPU is in use.
2. While mismatched, the dashboard container **will not start at all** (CDI spec
   generation fails). That is the expected failure, not a bug in this app.
3. Note that Jellyfin can keep transcoding through such a mismatch, because its
   bind-mounted driver libraries are the older inodes from before the upgrade.
   It loses hardware transcoding the moment that container restarts — and
   `watchtower` will eventually restart it. A working Jellyfin is not evidence
   that the driver is healthy.
4. The `/gpu` route diagnoses itself: each unavailable state names the specific
   next action (enable the runtime, reboot the host, and so on), so visiting the
   page is always safe and usually tells you the answer.

## Drive health / SMART (`/resources` DISK tab)

Enabled 2026-07-30. `smartctl` needs root **and** raw device nodes; this container
has neither (uid 1000, no `/dev/nvme*`). Rather than hand a web-facing container
`CAP_SYS_RAWIO` and raw disk ioctls, a host-side systemd timer publishes
smartctl's JSON and the dashboard reads the file.

**Install (one-time, host):**

```sh
scp scripts/host/nightwatch-smart.* homelab@192.168.1.70:/tmp/
ssh homelab@192.168.1.70 '
  sudo install -m 0755 /dev/stdin /usr/local/bin/nightwatch-smart < <(tr -d "\r" < /tmp/nightwatch-smart.sh)
  sudo install -m 0644 /dev/stdin /etc/systemd/system/nightwatch-smart.service < <(tr -d "\r" < /tmp/nightwatch-smart.service)
  sudo install -m 0644 /dev/stdin /etc/systemd/system/nightwatch-smart.timer < <(tr -d "\r" < /tmp/nightwatch-smart.timer)
  sudo systemctl daemon-reload
  sudo systemctl enable --now nightwatch-smart.timer'
```

`tr -d "\r"` matters — the same CRLF caveat as `git archive`, and systemd will
refuse a unit file with carriage returns.

Output lands at `/var/lib/nightwatch/smart.json` (root-owned, world-readable) and
is read at `/host/rootfs/var/lib/nightwatch/smart.json`. That bind mount already
existed for host metrics, so **this needs no compose change, no `cap_add`, and no
`devices:` passthrough**.

**Removal:** `sudo systemctl disable --now nightwatch-smart.timer`. The card then
shows the collector as STALE and says which unit to check — it does not break.

### Notes

- The script passes `-n standby` so polling never spins up a sleeping disk.
  smartd uses the same flag. A standby drive renders as "standby · not woken"
  rather than as missing data.
- **smartctl's exit code is a bitmask, not a success flag.** Bit 6 (64) means
  "errors recorded in the error log" — exactly what this card exists to show.
  `/dev/nvme1n1` on this host exits `4` ("Read Self-test Log failed") while
  `smart_status.passed` is `true`. The script keeps the JSON regardless and
  `src/lib/smart.ts` decides from the payload.
- The script does **no** interpretation — it concatenates smartctl's JSON
  verbatim. Every threshold and judgement lives in `src/lib/smart.ts`, so
  changing the UI never means touching the host again.
- Live temperatures come from `/host/sys/class/hwmon` instead, which is instant
  rather than up to 5 minutes old. Thresholds outside 20–120 °C are discarded:
  hwmon reports unset limits as `65261850` m°C (65261 °C) on both NVMe drives.
- This host has **no ZFS, no Btrfs and no mdraid**. Those readouts are written
  against sysfs and will populate if a pool ever appears; until then the card
  says "not present", which is a fact, not a fault.

## Network monitor (`/networks`)

Added 2026-07-30. Interface throughput, docker-bridge breakdown and the host's
listening ports. **No compose change, no new capability, no new socket-proxy
scope** — everything comes from bind mounts that already existed.

| Data | Source |
|---|---|
| Interface counters (1 Hz, via the telemetry SSE) | `/host/proc/1/net/dev` |
| Link speed, operstate, MTU, MAC, bond slaves, bridge members | `/host/sys/class/net/<if>/` |
| Listening sockets | `/host/proc/1/net/{tcp,tcp6,udp,udp6}` |
| uid → username for host-owned ports | `/host/rootfs/etc/passwd` |
| Bridge → docker network name, published-port → container | docker socket-proxy (already permitted) |

### Notes

- **Always `/host/proc/1/net/…`, never `/host/proc/net/…`.** `/proc/net` is a
  symlink to `/proc/self/net` and `self` resolves in the *reading* process's
  network namespace, so the bind-mounted path returns the **container's** single
  `eth0` instead of the host's 30-odd interfaces. Pid 1 is host init, so its
  namespace is the host's. Same trap as `/proc/mounts` — see the drive-health
  notes. `getHostNetCounters()` already did this; the collector follows it.
- **Counters overlap by design and must never be summed.** One download crosses
  `enp4s0` → `bond0` → a `br-*` bridge → a `veth`, and appears in all four. The
  page encodes this in its ordering: only `uplink` is host throughput, the bond
  slave is labelled as the same packets, and the veths are collapsed behind a
  disclosure that says so. `InterfaceRole` in `src/lib/network-types.ts` is what
  enforces it.
- **Link speed is only trusted for physical interfaces.** sysfs reports `10000`
  for a veth and garbage for a bridge; a utilisation bar scaled to a fabricated
  10 GbE would render a saturated 1 GbE link as idle. Bridges and veths get
  `speedMbps: null` and no utilisation bar.
- **Utilisation uses the busier direction, not rx+tx.** Ethernet is full duplex:
  125 MB/s each way at once is 100 % both ways, not 200 % of anything.
- **Port → process is not available and is not guessed.** `/proc/net/tcp` gives a
  uid and a socket inode; resolving the inode to a pid needs `/proc/<pid>/fd`,
  which is `0500` and unreadable as uid 1000. Ports docker publishes are named
  from the daemon's port bindings; everything else shows the uid and reads
  "unattributed". No well-known-ports lookup table — that would be fabrication.
  Note this names the container *holding the binding*: the \*arr ports resolve to
  `gluetun`, which is the truth about who owns the socket.
- This host has **no `eth0`, no tailscale and no wireguard** despite what a
  generic bandwidth-monitor brief assumes. The role classifier handles them if
  they ever appear; the page renders what is actually there — `bond0` over
  `enp4s0`, `docker0`, seven `br-*` bridges and ~24 veths.

## Rollback

```sh
# previous commit → re-archive and rebuild
git archive --format=tar HEAD~1 | ssh homelab@192.168.1.70 \
  "sudo tar -xf - -C /mnt/docker/stacks/homelab-dashboard"
ssh homelab@192.168.1.70 "cd /mnt/docker/stacks/homelab-dashboard \
  && sudo docker compose build && sudo docker compose up -d"
# nuclear: sudo docker compose down (Homepage on 3001 is untouched either way)
```

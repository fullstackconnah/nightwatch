# Homelab-native kiosk signals

Lens: which homelab/server signals belong on the ambient wall display, and
how the attention model should grow. No code changes — analysis only.

## Probes today (cited, with thresholds)

`getAttention()` runs five probes in a fixed priority order and returns the
**first** non-null hit — never a summary of everything that's slightly off
(`attention.ts:282-298`). Every probe is independently try/caught; a broken
probe degrades to "found nothing," never a fabricated card (`attention.ts:290-298`).
Result is cached at module scope for 30s (`CACHE_TTL_MS`, `attention.ts:38,306-313`),
which also means every kiosk tablet hitting the same server shares one
evaluation for free — no per-client dedup needed.

1. **Container death** — `probeContainerDeath`, `attention.ts:84-110`. Fires
   on any container in Docker's `dead` state, or `exited` with a nonzero exit
   code where `startedAt` is set (ruling out "created but never started").
   Severity `bad`. No threshold — binary state. Known false-negative: a clean
   `exited(0)` under an `on-failure` restart policy. Known false-positive: an
   intentional `docker stop` that outran the 15s SIGTERM grace period and got
   SIGKILLed (comment at `attention.ts:79-82`).
2. **Restart loop** — `probeRestartLoop`, `attention.ts:123-148`. Fires on
   the live `restarting` state, OR when `restartCount` climbed versus the
   value this same module recorded on its *own* prior call (a `globalThis`
   baseline, `attention.ts:124-125,145`). Any increase of 1 triggers; the
   baseline re-arms every call, so a container that stops restarting clears
   within 1-2 probe cycles. Severity `bad`.
3. **SMART / array integrity** — `probeSmart`, `attention.ts:167-191`. A
   drive `verdict === "bad"` always fires (`bad`). A drive `verdict ===
   "unknown"` only fires if this module previously saw that *same* drive as
   `"ok"` or `"warn"` — i.e. SMART data that used to work just stopped
   (tracked via a second `globalThis` map, `attention.ts:174-188`), severity
   `warn`. Ordinary elevated-but-not-failing `"warn"` verdicts are
   deliberately never surfaced here (`attention.ts:161-164`) — they're
   already on the real dashboard and would erode the silence this card
   depends on. RAID/LVM/ZFS/Btrfs/filesystem-error integrity rides the same
   probe via `snapshot.integrity.verdict === "bad"` (`attention.ts:170-172`,
   backed by `ArrayIntegrity` in `smart-types.ts:189-199`) — **RAID/pool
   degradation is already covered**, not a gap.
4. **Disk capacity** — `probeDiskCapacity`, `attention.ts:228-259`. Fires at
   an absolute `>85%` used (`DISK_WARN_PCT`, `attention.ts:45,248`), OR
   independently when a mount is already `≥75%` full AND projected to cross
   100% within 30 days (`GROWTH_HORIZON_DAYS`, `attention.ts:46,242-247`) at
   its current growth rate, requiring ≥24h of real history before trusting a
   trend (`THIN_HISTORY_MS`, `attention.ts:44,205`). **Notable: this probe
   always returns severity `warn`, even at 99% used or <1 day to full** —
   there is no `bad` branch for disk capacity today. Worth a small threshold
   tune later (e.g. `>95%` or `daysToFull <= 3` → `bad`), not addressed here.
5. **Failing healthcheck** — `probeUnhealthy`, `attention.ts:263-267`. Any
   container with Docker health status `"unhealthy"`. Severity `warn`.

The card itself (`kiosk-attention.tsx`) renders nothing until one probe
fires (`kiosk-attention.tsx:47-50`), shows exactly one headline/detail/since,
and has no error state of its own — an unreachable route also renders
nothing (`kiosk-attention.tsx:47-50`). Two adjacent surfaces **duplicate**
two of these five signals as an always-visible strip, independent of the
priority gating above: `kiosk-health.tsx:32-34` and
`kiosk-status-strip.tsx:47-49` both compute `dead > 0 ? "bad" : unhealthy >
0 ? "warn" : null` directly from `/kiosk/api/health` counts. Consequence: if
a disk-capacity or SMART alert currently owns the one attention card, a dead
container still shows up in the status strip's small chip — the two panels
never contradict each other, but they aren't the same code path.

## Proposed probes

| Probe | Act-on-it-now? | Source | Cost (hrs) |
|---|---|---|---|
| WAN/internet outage (vs LAN-only) | **Yes** — explains "it's not just your phone," everyone's streaming/browsing is dead | New: server-side DNS + HTTP reachability check against 1-2 well-known endpoints, timeout-guarded, cached like the others | 2-3 |
| NPM certificate expiring/expired | **Yes**, though only the admin can renew — household sees "the app just broke" | Existing data: `ProxyCertificate.expiresOn` / `RouteCertRef.expiresOn` already fetched for `/proxy` (`npm-types.ts:31,53`); config is optional (`npm?:` in `config.ts:59`, not yet set per task-board) — probe must skip silently when unconfigured | 1-2 |
| Blast-radius phrasing for load-bearing containers (Pi-hole/NPM/gluetun) dying | **Yes** — turns a generic "pihole has died" into "no internet browsing until this is fixed." This is a copy enhancement to the *existing* probe, not a new one | Existing: `probeContainerDeath` (`attention.ts:84-110`) + a small hardcoded allowlist of container-name patterns | 1 |
| VPN kill-switch leak (gluetun health/public-IP mismatch) | Admin-actionable, household-relevant only indirectly (unprotected torrent traffic) | New — no gluetun-specific plumbing exists anywhere in the repo today; container *death* is already caught generically, but a "container running, tunnel silently down" state is invisible | 4-6 |
| UPS on-battery / imminent shutdown | **Highest urgency of any candidate if it fires** — "save your work, power's out" | New — no NUT/apcupsd integration exists; **blocked on whether a UPS is even present**, unverified from this codebase | 4-8, conditional on hardware |
| SMART trend (not just verdict flip) | No | The design already deliberately excludes ordinary `"warn"` drives from this card (`attention.ts:161-164`) to protect the silence budget — a trend probe would fight that intent | reject |
| Backup freshness/failure | Would be yes, but nothing to read | No backup mechanism exists anywhere in this repo (deploys are `git archive` + Dockge, not a scheduled backup job) — this needs new backup infrastructure before any probe is possible | out of scope here |
| ZFS/RAID/pool degradation | Already covered | `probeSmart` via `ArrayIntegrity` (`attention.ts:170-172`) | 0 |
| DNS/adblock (Pi-hole) failing open (not blocking, but still resolving) | No | Cosmetic, not urgent — a fully-dead Pi-hole is already caught by container death | reject |
| Update-available counts | No | Zero urgency, textbook dashboard noise | reject, `/dash` only |
| Immich/photo ingest stalls | No | "Check within a day," not "act on walking past" | reject, `/dash` only |
| Media library scan failures / stuck download queue | No | Same — no immediacy | reject, `/dash` only |

## Escalation model

Today: two severities (`warn`/`bad`, `attention.ts:22`), one card, no
acknowledge/snooze, no audio, re-evaluated every 30s
(`kiosk-attention.tsx:22,25-28`) but with a one-time entrance animation that
doesn't re-trigger on a routine re-poll of the *same* condition
(`kiosk-attention.tsx:32-45`).

- **More severity tiers**: not worth adding speculatively. Two levels
  already cover every probe that exists. Only the UPS probe above would
  plausibly justify a third `critical` tier ("<2 min of runtime left") —
  defer until/unless that probe ships.
- **Acknowledge/snooze**: recommend **against**. The card's own thesis is
  that silence must mean "nothing wrong" (`kiosk-attention.tsx:3-12`); a
  snoozed-but-still-broken container reintroduces exactly the kind of
  silent failure that design is built to prevent. No change needed.
- **Audible/visual escalation at night**: the kiosk already has a
  night/wake concept (`isNight`, `showNightOverlay`, `wakeNight` in
  `kiosk/page.tsx:96-103,154`). Piping `severity === "bad"` into forcing the
  screen awake (visual only) is a small, justified addition — do **not**
  add sound; nothing in this codebase establishes tablet audio as a
  supported surface, and a voice/audio pipeline is already tracked
  separately and deferred (task-board.md: "voice pipeline... Deferred").
  ~2h if pursued.
- **"Someone already handled it" shared state**: already true for free.
  `getAttention()` is cached at module (server process) scope
  (`attention.ts:306-313`), so every kiosk tablet polling the same
  nightwatch instance sees the identical result — there's no per-client
  dismissal to reconcile. Only matters if kiosks ever point at different
  server instances, which they don't today.

## Safe kiosk actions

Docker lifecycle verbs available anywhere in this app: `start / stop /
restart / pause / unpause` (`CONTAINER_ACTIONS`, `docker.ts:696-697`),
requiring `CONTAINERS=1` + `POST=1` on the socket-proxy
(`docker.ts:700-704`). `BUILD=0` keeps build-cache pruning impossible from
any surface (`docker.ts:426-429,505-506`), and the proxy never exposes
`EXEC` at all (`README.md:73-74`) — the app cannot shell into a container
even if fully compromised.

Critical baseline fact: **the kiosk today, even PIN-elevated, exposes zero
Docker lifecycle actions.** The elevated tool cluster is `KioskVoicePanel`,
`KioskAppearance` (layout picker), and `KioskAdminPanel` (lock control) only
(`kiosk/page.tsx:176-182`). Container start/stop/restart lives exclusively
on the authenticated `/dash` Containers page. Any kiosk action below is new
attack surface, not a documented extension of something that already ships.

- **Scoped restart of the exact container an active alert names** — safe to
  add behind PIN elevation. It reuses `containerAction("restart")`
  (`docker.ts:706-714`, own 15s graceful-stop), discloses no new
  information (the name is already public in the alert headline per
  `attention.ts:29-31`), and restart is the least destructive mutating
  verb available. Needs: the attention API to also carry the container id
  (today it's intentionally name-only), and the PIN check enforced
  server-side at that action route, not just hidden client-side. ~2-3h.
- **Prune / reclaim** — reject for kiosk. `pruneReclaimable()`
  (`docker.ts:510-522`) already exists for `/dash`, but no attention probe
  ever points at "go prune" — the disk-capacity probe reports percentage
  and days-to-full, not a prune recommendation, so there's no alert this
  action would even attach to on a wall panel. Stays `/dash`-only.
- **Dismiss/acknowledge as an "action"** — reject, per Escalation model
  above.
- **General stop / pause / create / anything requiring the New Container
  form** — reject outright for a wall panel; stays `/dash`, PIN or no PIN.
  `EXEC` stays off every surface, kiosk included, permanently.

## Rejected — dashboard only

Update-available counts, Immich/photo ingest stalls, media library scan
failures, stuck download queues, DNS/adblock "failing open" (not fully
down), SMART attribute trend lines, prune/reclaim actions from the kiosk,
and any general container start/stop/create from the kiosk. None of these
clear the "would a household member walking past need to act on it right
now" bar — they're either admin-only, low-urgency, or already visible on
`/dash` in a form suited to deliberate review rather than a glance.

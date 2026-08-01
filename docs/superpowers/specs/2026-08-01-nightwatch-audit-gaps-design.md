# Nightwatch audit-gap closures — Design (2026-08-01, second wave)

Follow-up to the 2026-08-01 expansion. A four-agent screenshot audit graded
the owner's original ideas list against the shipped app; this spec closes
the feasible gaps. Verified empirically before scoping: the socket proxy
passes the DELETE method with current scopes (image removal needs no new
scope). All cross-cutting rules from the previous spec apply (DESIGN.md
tokens/idioms, no new runtime deps, honest states, test-stack browser
verification, `tsc && build` gate).

## Wave 1 (parallel, disjoint files)

### G1 — Metrics history + host CPU/MEM time-series (/resources)

- **Persistence (decision):** no database. A sampler piggybacked on the
  existing 1 Hz telemetry loop appends a compact JSON line every 30 s to
  `DATA_DIR/history/metrics-YYYY-MM-DD.jsonl`:
  `{t, cpu, memUsed, memTotal, mounts: {mountpoint: usedBytes}, containers: {name: [cpuPct, memBytes, rxBps, txBps]}}`.
  Daily files, prune >14 days on rotation. Write failures degrade silently
  (history is an enhancement, never breaks live telemetry). Mount snapshots
  are recorded now so the wave-2 disk-growth chart has data accumulating.
- **API:** `GET /api/telemetry/history?range=1h|24h|7d&containers=a,b` →
  server-side downsampled (~360 points) host + selected-container series.
- **UI:** CPU and MEM tabs gain the host-level chart NET/DISK-IO already
  have, with a range segmented control: `LIVE` (existing 60 s ring) /
  `1H` / `24H` / `7D`. A container picker (chips, up to 4) overlays
  per-container history on the host chart. Honest empty state while
  history accumulates ("recording since <time> — come back in an hour").
- Also: the ALL/processes view accepts `?q=<name>` to prefill its filter
  (enables deep links from container surfaces; G3 links to it).
- **Files owned:** `src/lib/telemetry.ts`, `src/lib/telemetry-types.ts`,
  `src/lib/metrics-history.ts` (new), `src/app/api/telemetry/**`,
  `src/app/(dash)/resources/page.tsx`, `src/components/resource-overview.tsx`.

### G2 — Images: repository grouping + per-image delete (/images)

- Group rows by repository (path before the tag): one group row (repo,
  registry chip, tag count, total size) expanding to its tags; unused tags
  keep their badge. Dangling images group under `<untagged>`.
- Per-image delete: `DELETE /api/docker/images/[id]` (dockerode
  `removeImage`, no force). In-use images render the action disabled with
  the owning container named. Two-step inline confirm, danger tint,
  result copy with freed bytes; refreshes list + reclaim panel.
- **Files owned:** `src/app/(dash)/images/**`, `src/app/api/docker/images/**`,
  `src/lib/docker.ts`, `src/components/reclaim-images.tsx` (only if the
  freed-bytes refresh needs a shared hook tweak).

### G3 — Overview sort/filter + widget app-API actions

- Overview (`/`): text filter (name/image) and a sort control
  (group default | name | CPU | memory | state) using the segmented-button
  idiom; `/containers` gains column sorting (name, CPU, mem, state).
- Widget actions (decision: curated builtins, code-defined, shown only
  when that app's widget is configured): Pi-hole disable blocking
  (5 min) / re-enable; Sonarr + Radarr RSS sync and missing-search
  triggers; qBittorrent pause-all / resume-all. Server route
  `POST /api/widgets/action { container, action }` executes against the
  app's own API with config.json creds (middleware session auth; secrets
  never to the client). UI: action buttons on the container detail page's
  widget card + a compact menu on overview tiles; two-step confirm;
  success/failure as real copy.
- Container rows/detail link "processes →" to `/resources?metric=all&q=<name>`.
- **Files owned:** `src/app/(dash)/page.tsx`, `src/app/(dash)/containers/**`,
  `src/components/container-tile.tsx`, `src/lib/widgets/**`,
  `src/app/api/widgets/**`, new `src/components/widget-actions.tsx`,
  `src/lib/tiles.ts` if sorting needs it.

### G4 — Networks: established connections + container comparison chart

- Established-connections panel: parse ESTABLISHED rows from
  `/host/proc/1/net/tcp{,6}` (pid-1 namespace rule per DEPLOY.md), attribute
  the local endpoint via the existing port→container map (else uid), group
  by remote address; disclosure UI like the host-only ports group.
  Flagging (Threshold Rule — only real signals): public (non-RFC1918/6)
  remote addresses get a marker; a single remote holding >50 concurrent
  connections gets a warn count. No fabricated geo/threat data.
- Container network comparison: in Container footprint, chips select up to
  4 containers whose rx/tx series (existing 60 s telemetry samples) overlay
  on one chart (accent + blue + ramp steps; honest "60 s window" caption).
  Long-range comparison waits for G1's history API (wave 2 wiring).
- **Files owned:** `src/lib/network.ts`, `src/lib/network-types.ts`,
  `src/app/(dash)/networks/**`, new `src/components/net-connections.tsx`,
  `src/components/net-compare.tsx`.

## Wave 2 (after G1 lands — shares resources/page.tsx)

### G5 — Disk explorer: drill-down, pins, largest files, duplicates, growth

- Contents drill-down: scan any subpath on demand (breadcrumb navigation,
  30 min cache per path). Pinned folders: `pinnedFolders?: string[]` in
  config.json (schema change owned here); pinned paths always listed with
  current size on the DISK tab.
- Largest files: recursive on-demand scan of a chosen path (caps: 60 s
  budget, 100k entries, top 100 results, skips other-filesystem mounts);
  progress via polled job state; honest partial-results copy on cap hit.
- Duplicates (decision: opt-in, per-path, capped — never automatic):
  same-size grouping, then head+tail 1 MiB hash within size groups;
  results grouped with total wasted bytes; explicit cost warning copy.
- Disk growth: chart mount used-bytes over time from G1's history
  snapshots (24H/7D/14D), flagging fastest-growing mount.
- **Files owned:** `src/lib/disk-usage.ts`, new `src/lib/disk-scan.ts`,
  `src/app/api/resources/**` (scan/jobs routes), `src/lib/config.ts`
  (pinnedFolders key), `src/app/(dash)/resources/page.tsx`, new
  `src/components/disk-*.tsx`.

## Explicitly out of scope (with reasons)

- GPU management actions (kill/clock/power): requires a privileged pathway
  the architecture deliberately lacks (EXEC=0); read-only stays.
- Per-connection duration/bytes: not present in /proc/net/tcp; would
  require conntrack access — a new privilege decision for the owner.
- Metrics retention beyond 14 days / external TSDB: out of proportion for
  this app; revisit only if 14-day JSONL proves insufficient.

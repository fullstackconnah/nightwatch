# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Single admin (the owner) monitoring and managing their Docker home server (192.168.1.70). Used on desktop at a desk and on a phone around the house — glance-first checks ("is everything up, what's eating resources") followed by quick actions (restart, stop, open the app). No other users; auth exists to gate LAN/remote access, not to model roles.

## Product Purpose

"nightwatch" — a self-hosted homelab dashboard that replaced Homepage on the server. Shows container health, host vitals, per-app widget stats, and provides container lifecycle actions (start/stop/restart/pause/resume/create) plus links into each app's own UI. Success = the owner trusts it enough to retire Homepage/Glances and answer any "what's wrong / what's heavy" question in seconds.

## Operating Context

- Talks to Docker through a scoped socket-proxy container (read-mostly; EXEC=0; POST/IMAGES/CONTAINERS enabled for lifecycle + create). Adding proxy scopes is a deliberate, user-approved act (SYSTEM=1 for /system/df approved 2026-07-29 for volume sizes).
- Deployed via git archive → `/mnt/docker/stacks/homelab-dashboard`, built on-server, managed by Dockge (runbook: DEPLOY.md).
- ~26 containers on the box (media stack, *arr apps, infrastructure). Widget data (Sonarr/Radarr/qBittorrent/Pi-hole etc.) fetched server-side with keys in gitignored `data/config.json`.
- Dev mode: SSH tunnel to the docker socket + `npm run dev` (port 3005); dev accepts any password.

## Capabilities and Constraints

- Next.js 15 / React 19 / Tailwind v4; no chart library — hand-rolled fluid SVG (`src/components/charts.tsx`); no new runtime dependencies without reason.
- Polling via lightweight client hooks (`src/lib/client.ts`); server routes under `src/app/api/`.
- Mobile-optimized 2026-07-29: bottom tab bar below `md`, card fallbacks for tables, 44px touch targets. Desktop ≥768px layouts are deliberate and stable.
- Per-container stats come from the Docker stats endpoint; per-container disk from `containers/json?size=1` (image + RW layer); volume sizes only via `/system/df`.

## Brand Commitments

Dark-only "homelab console" identity (confirmed in use): near-black blue ground `#070b11`, `.panel` hairline surfaces, teal accent, Inter UI text with mono for data/IDs/paths, 10px `.microlabel` captions, status dots, faint blueprint-grid body texture. Refinements preserve this world.

## Product Principles

- Glance first: state and anomalies readable in seconds, on a phone, from across the room.
- Actions one tap from information — never bury lifecycle controls behind navigation.
- Data density over decoration, but every number labeled in the app's own idiom (mono, microlabels).
- Server does the fetching; the browser only polls the app's own API.
- Least-privilege Docker access; new socket scopes are explicit decisions.

## Accessibility & Inclusion

Touch targets ≥44px on mobile; hover-only affordances always have a touch-visible equivalent (established 2026-07-29).

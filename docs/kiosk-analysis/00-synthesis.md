# Kiosk mode — feature analysis synthesis (2026-08-03)

Five parallel analyses, one lens each, all citing source:

| Doc | Lens |
|---|---|
| `01-ambient-display.md` | Glanceable design + screen optimisation at 1–3 m |
| `02-smarthome-control.md` | HA control surface depth |
| `03-household-features.md` | Household staples vs Nest Hub / Echo Show / DAKboard |
| `04-platform-reliability.md` | 24/7 unattended iOS PWA reliability |
| `05-homelab-signals.md` | Attention-probe expansion + escalation |

Claims spot-verified by the orchestrator before ranking: no error boundary or
service worker exists anywhere in `src/`; `metricsDown` requires *both* vitals
and health to fail (`kiosk-status-strip.tsx:50`); `refreshKioskElevation`
collapses network failure into `{elevated:false}` (`kiosk-client.ts:50-52`);
`probeDiskCapacity` only ever returns `hit("warn")` (`attention.ts:254`);
`weather.ts` calls only `api.open-meteo.com` forecast — no air-quality endpoint.

---

## The headline

The kiosk is feature-rich and reliability-poor. It has a rain nowcast, twelve
themes, a real-sky ambience layer, multi-timers, an LLM briefing and an
alert-by-exception engine — but **one unhandled render exception blanks the
screen to white with no self-heal**, and a wifi blip silently kicks an elevated
panel back to the PIN pad. For a display whose whole job is to be trusted at a
glance without anyone touching it, that ordering is backwards.

Second theme: the *distance-correct* layout (Glance) is opt-in behind an admin
PIN, while the desk-density layout (Standard) is the silent default on every
fresh device. The smart-display optimisation the user is asking about is partly
already built and simply not switched on.

---

## Tier 0 — reliability (do first; ~7–9h total)

Cheap, unblocked, and each prevents a class of unattended failure.

| # | Work | Prevents | Cost | Source |
|---|---|---|---|---|
| 1 | `error.tsx` + reload fallback for `/kiosk` | Permanent white screen after any render exception | ~1h | 04 |
| 2 | Elevation refresh distinguishes "server said no" from "couldn't reach server" | False PIN lockout on a wifi blip mid-session | 1–2h | 04 |
| 3 | Honest stale state on status strip + hub — copy the `lastOk`/`StaleTag` pattern `useWeatherView` already uses correctly (`kiosk-display.tsx:188-210`) | Minutes-old container counts and HA tile states rendering as if fresh; tapping a tile on stale state | 3–4h | 04 |
| 4 | Nightly quiet-hours self-reload during the night period | Stale JS chunks after a deploy under a running panel; long-uptime drift | 1–2h | 04 |

Item 3 is the one with real design content: the correct pattern already exists
in this codebase, in this same directory, applied to weather only.

## Tier 1 — screen optimisation for the use case (~9–15h)

This is the direct answer to "optimise the screen for a smart display".

| # | Work | Why | Cost | Source |
|---|---|---|---|---|
| 5 | Make **Glance the default** for a fresh device; Standard becomes the elevated choice | The distance-correct surface shouldn't require finding a setting behind a PIN. `LAYOUT_STORAGE_KEY` already exists — this is a default-value flip | 1–2h | 01 |
| 6 | Drive `useKioskPeriod` off the real `sun.phase`/elevation already fetched for `KioskSky`, not fixed 5/22 clock hours | Dawn/dusk currently mismatch reality; the data is already on the wire | 2–4h | 01 |
| 7 | Night dimming ramp tied to sun phase | Full-brightness white clock in a dark hallway at 2am — biggest night-behaviour gap | 2–3h | 01 |
| 8 | Auto light/dark theme family by period (explicit tri-state so it never fights a pinned manual choice) | Light identities + per-theme sky caps are fully built and unused for their obvious purpose | 3–5h | 01 |
| 9 | Pixel-shift the clock ±4–8px hourly | LCD image persistence on the one permanently-static element | 0.5–1h | 01 |

## Tier 2 — features that earn wall space (ranked by value ÷ cost)

| # | Feature | Cost | Notes | Source |
|---|---|---|---|---|
| 10 | **Blast-radius phrasing** — "no internet browsing until fixed", not "pihole has died" | ~1h | Best value/cost on the entire list. Copy-only, enhances an existing probe | 05 |
| 11 | Bin / waste collection night | 2–3h | Local date math off a config field; no API exists to depend on | 03 |
| 12 | WAN-vs-LAN outage probe | 2–3h | Nothing today separates "internet is out" from a quiet host | 05 |
| 13 | UV + air quality band | 3–4h | Open-Meteo's free air-quality endpoint is simply never called; same fetch/cache shape already proven. UV is culturally load-bearing in AU | 03 |
| 14 | Light **dimming** | 4–6h | Brightness is already fetched and drawn as a fill bar; only `toggle` is wired. Highest-value HA gap | 02 |
| 15 | Shared shopping / task list | 4–6h | Category staple entirely absent. Use `config.ts`'s atomic JSON-write, not the timers' localStorage | 03 |
| 16 | NPM certificate expiry probe | 1–2h | `ProxyCertificate.expiresOn` already fetched by `/proxy`. Blocked on NPM creds | 05 |
| 17 | Calendar / agenda via ICS subscription | 8–12h (+4–6h basic recurrence) | Biggest single gap vs every category leader. Hand-roll VEVENT the way `briefing.ts:137-153` scopes RSS. Skip full RRULE | 03 |
| 18 | Photo frame from Immich / PiGallery2 | 6–10h | A differentiator Nest Hub can't match. **Sequence after #7** — same night-overlay real estate | 03 |
| 19 | Covers / garage open-close-stop | 5–7h | "Did I close the garage" is a classic wall-panel query. Needs a PIN-elevation *tier* that does not exist yet (see conflicts) | 02 |
| 20 | Room / area default view per device | 8–12h | Reuses the `kiosk-layout` per-device pattern, but needs HA's area registry — a call class the app doesn't make today | 02 |

## Defect found in passing

`probeDiskCapacity` (`attention.ts:228-259`) returns `hit("warn", …)` on every
branch — it never escalates to `bad`, even at 99% used. The live incident on
2026-08-01 (root filesystem at 97%, 24GB of build cache reclaimed) is exactly
the case that should have shouted. Threshold tune, ~1h.

---

## Cross-lens conflicts, resolved

1. **Screen Wake Lock.** 01 scoped it at 1–2h as an easy win. 04 is right: the
   API is secure-context-only (iOS Safari 16.4+), so it is **blocked until
   HTTPS**, not a quick win. Moved out of Tier 1 into the HTTPS bundle.
2. **The night overlay is contested real estate.** Night dimming (01),
   severity-forced wake (05), and the photo frame (03) all target
   `KioskNightOverlay`. Build in that order — dimming establishes the
   brightness model the other two must respect.
3. **Severity escalation has no producer.** 05 proposes forcing the screen
   awake at night on `severity === "bad"`, but the disk probe — the most
   likely night-time "bad" — can only emit `warn`. Fix the threshold (above)
   or the escalation path stays dead code.
4. **PIN tiers are new mechanism, not config.** PIN elevation today governs
   Docker admin only and has never been wired to any HA action; locks are
   stripped by two independent server-side blocks. A "PIN-gated middle tier"
   for garage/covers is a build, not a flag.

## One dependency unlocks three features

HTTPS (already tracked in `PENDING-SETUP.md` for the mic) is also the gate for
**Screen Wake Lock** and **Service Worker** — neither previously recorded as
HTTPS-dependent. That makes it: voice, always-on without an OS setting, and
offline app shell + deploy-safe caching. Worth re-pricing on that basis.

## Not worth doing (agreed across lenses)

Content rotation/carousel (deliberately rejected in `kiosk-display.tsx:6-8` and
still right) · OLED burn-in mitigations (LCD hardware) · acknowledge/snooze on
the attention card (fights its own silence thesis) · audible alerts (no tablet
audio surface) · WS push replacing the 7s poll · full HA automation editing ·
per-user roles/OIDC · transit, flights, parcel tracking (no free keyless API,
new deps) · SMART trend warnings, backup freshness, update counts, ingest
stalls (check-within-a-day, not walk-by-act-now).

## Blocked on things that don't exist yet

Camera/doorbell (no hardware — cheapest v1 when it lands: go2rtc snapshot + HA
event over the `/logs` SSE pattern → modal, not WebRTC) · UPS on-battery
(unverified whether a UPS exists) · presence-based wake (needs a motion sensor
entity) · media player (needs `media_player.*` entities) · voice → HA actions
(no intent-dispatch path; needs its own safety pass — "unlock the door" near an
open mic is the failure mode).

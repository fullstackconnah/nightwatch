# Kiosk as a home control surface

Lens: what a wall-mounted control panel needs to *do*, not just show. HA is
unconfigured today (no token in `data/config.json`), so every gap below is
buildable against the documented HA REST contract and exercised through the
app's existing "unconfigured" honest-degrade path — but none of it can be
smoke-tested against a live HA instance until the owner adds credentials.

## Current state (cited)

### Entity types / control affordances

| Domain | Read | Write | Notes |
|---|---|---|---|
| light | on/off, brightness % | **toggle only** | `mapLight` reads `brightnessPct` (`src/lib/ha.ts:84-96`) and the tile shows it as a fill bar (`kiosk-hub.tsx:232-239`), but the only action wired is `toggle` (`kiosk-hub.tsx:319`); there is no `set_brightness`/dimming action anywhere in `PUBLIC_ACTIONS` (`src/app/kiosk/api/ha/action/route.ts:21`) or `performHaAction` (`src/lib/ha.ts:408-413`). |
| switch | on/off | toggle | `kiosk-hub.tsx:347-385`. |
| scene | exists/available | activate | `kiosk-hub.tsx:387-424`, `ha.ts:448-456` (`scene.turn_on`). |
| climate | current/target temp, hvac mode | hvac mode buttons, ±0.5° nudge (max 2°/request) | `kiosk-hub.tsx:426-542`; nudge is read-current-add-write-back server-side, not a native HA service (`ha.ts:333-393`); per-request delta capped at `MAX_NUDGE_DELTA = 2` independently of the client (`action/route.ts:34,79-82`). No fan-mode or preset (away/eco/boost) control — `HaClimate` has no such fields (`src/lib/ha-types.ts:35-51`). |
| lock | — | — | **Fully stripped from the kiosk**, not just hidden: `states/route.ts:21-25` zeroes `entities.locks` before the response leaves the server, and `action/route.ts:15-27` excludes `lock`/`unlock` from `PUBLIC_ACTIONS` *and* keeps `lock` out of `ALLOWED_DOMAINS` — two independent server-side blocks, by design ("a physical-security boundary… not exposed on the kiosk at all", `action/route.ts:15-19`). Locks exist on the authenticated `/smarthome` surface with a double-tap arm/confirm pattern (`src/components/ha-locks.tsx:85-99`, 4s confirm window). |
| sensor | temperature/humidity/battery, read-only | — | Only 3 device classes surfaced; everything else `sensor.*` reports is dropped (`ha.ts:147-159`). |
| cover, media_player, fan, vacuum | **none** | **none** | No type exists in `HaEntities` (`ha-types.ts:81-88`) and `buildEntities`'s domain switch has no case for any of them — they fall into the `default:` branch and are silently dropped (`ha.ts:196-225`). This is a type-level gap, not a UI oversight: adding any of these needs a new shape in `ha-types.ts`, a new mapper, a new switch case, and a new public action, not just a new component. |

### Room / area awareness

**None exists.** `ha.ts`, `ha-types.ts`, `kiosk-hub.tsx` and `use-ha.ts` contain
no `area`/`area_id`/`room` concept anywhere — confirmed by grep across `src/`
(the only hits outside HA code are unrelated files like `kiosk-sky.tsx`).
Entities are flat lists, alphabetized by `friendly_name` (`ha.ts:184-186,
227-234`); the hub renders one global Lights/Switches/Scenes/Climate/Sensors
set with no per-room split (`kiosk-hub.tsx:705-713`).

There **is** a precedent for device-local configuration to build on: the kiosk
layout picker (`standard` vs `glance`) is stored per-device in
`localStorage["kiosk-layout"]`, seeded from a `?layout=` query override for
testing (`src/app/kiosk/page.tsx:31-67`). The same pattern — `localStorage` +
query override, resolved client-side after SSR — is the natural place to hang
a per-device "default room" setting.

### Presence, proximity, wake

- The only existing "ambient → active" trigger is a **manual tap** on the
  night overlay: `showNightOverlay` gates a calm clock-only view during the
  `night` period (`kiosk/page.tsx:102-104`), and `wakeNight()` flips to the
  full layout for `NIGHT_WAKE_MS = 60_000` (60s) after a tap, then reverts
  (`kiosk/page.tsx:76,110-121`).
- Outside night, the Home hub (lights/switches/scenes/climate) is **always
  rendered**, unconditionally — it is not gated behind any presence or wake
  state at all (`kiosk/page.tsx:184`, `KioskHub` has no visibility prop).
  Only the admin panel / voice panel / layout switcher are gated, and that
  gate is PIN elevation, not presence (`kiosk/page.tsx:176-182`).
- PIN elevation itself "slides" (extends its 5-minute TTL) on **any**
  pointerdown while elevated, capture-phase so it fires even through buttons
  that stop propagation (`kiosk/page.tsx:151`, throttled to one network call
  per `SLIDE_MIN_INTERVAL_MS = 15_000`, `kiosk/page.tsx:20,129-137`). That is
  proximity-by-touch, not proximity-by-sensor.
- No HA `person.*`/`device_tracker.*`/motion-sensor entity is read anywhere
  in `ha.ts` — `person` domain is explicitly named as one of the domains
  dropped wholesale (`ha.ts:221`).

### Cameras / doorbell

Confirmed deferred, not overlooked: `.claude/state/task-board.md:57-60` lists
"cameras/go2rtc/doorbell popup" under "Deferred (decision 2026-08-01)", and
`docs/superpowers/specs/2026-08-01-nightwatch-expansion-design.md:11-13,64,98`
records the same call with the reason `hardware not installed`, plus explicit
scope notes "Out: … doorbell/video tiles" (§2) and "Out: … camera entities"
(§4). `docs/PENDING-SETUP.md:57-62` repeats it under "Still parked (need
decisions or hardware)". No code exists for this anywhere — no `camera`
domain handling in `ha.ts`, no route, no component. **This is still the right
call**: HA itself isn't even configured yet, so there is no backend to build
a camera/doorbell feature against, let alone test.

### PIN elevation / safety model

- The elevation cookie (jose JWT, 5-minute sliding TTL) governs **Docker
  container lifecycle only** — `KioskAdminPanel` reuses the same authenticated
  `/api/docker/containers` routes the logged-in dashboard uses
  (`kiosk-admin-panel.tsx:34-40`). It does **not** gate any HA action today;
  HA control has its own, separate, all-or-nothing authorization model.
- Every currently-exposed HA action (light/switch toggle, scene activate,
  climate mode + nudge) is reachable from `/kiosk/api/ha/action` with **zero**
  authentication — deliberately, per the route's own comment: "Public write
  surface… reachable with no session" (`action/route.ts:8-9`). This matches
  the "nobody wants a PIN to turn on a kitchen light" principle.
- Locks are the one HA domain that *is* a security boundary, and it is the
  only domain walled off — twice, independently (client-visible state
  stripped in `states/route.ts`, and the action route's own
  `ALLOWED_DOMAINS`/`PUBLIC_ACTIONS` allowlists don't trust `ha.ts`'s
  per-action domain checks alone: "defense in depth, so a bug or future
  loosening in `ha.ts` can't quietly widen what an anonymous device on the
  network can do", `action/route.ts:11-13`).
- `nudge_temp` is capped at 2°/request server-side, independent of whatever
  the client sends (`action/route.ts:34,79-82`) — protects against
  fat-fingered repeated taps walking a thermostat far in one burst.
- PIN entry itself is rate-limited per-IP (5 failures → 30s lockout,
  `src/app/api/auth/kiosk/route.ts:13-14,44-67`), but that protects the
  Docker admin surface the PIN unlocks, not HA.

## Gaps

1. **No dimming** — brightness is displayed but never settable; only full
   on/off.
2. **No covers** (garage door, blinds) — type-level gap, not just missing UI.
3. **No media_player** (transport, volume).
4. **No fan** domain.
5. **No vacuum** domain.
6. **No room/area model** — no grouping, no per-device default room, despite
   an existing device-local config pattern (`kiosk-layout`) that a room
   picker could reuse directly.
7. **No presence/sensor-driven wake** — only a manual tap wakes the panel
   from night ambient; no motion sensor or `person`/`device_tracker` entity
   is ever read.
8. **No camera/doorbell** — confirmed correct to defer (hardware absent);
   listed here only for completeness against the brief's checklist.
9. **HA actions have no elevation tier** — today it's binary: public domains
   are fully open, locks are fully closed. There's no PIN-gated middle
   ground for something that's comfort-adjacent but higher-stakes than a
   light (e.g. a garage door, if added) — worth deciding *when* covers are
   built, not before.

## Ranked proposals

| Proposal | Why | Cost (hrs) | Needs creds? |
|---|---|---|---|
| **1. Light dimming (brightness slider)** | Highest-value gap: brightness is already fetched and displayed, just not actionable. Every dimmable fixture in a household benefits daily. | 4–6 | No — same HA token already required for toggle; no new integration. |
| **2. Covers (garage door / blinds) open/close/stop** | "Did I close the garage?" is a top wall-panel query. Needs new `HaCover` type, `buildEntities` case, tile section, `open_cover`/`close_cover`/`stop_cover` actions, and `cover` added to `ALLOWED_DOMAINS`. Garage door specifically edges toward the "physical security" bucket locks occupy — worth a PIN-elevation decision at build time, reusing the `ha-locks.tsx` double-tap-confirm pattern rather than the locks server-side ban. | 5–7 | No — same HA token; garage-door-as-cover is a common HA setup already. |
| **3. Room/area default view (per-device config)** | Directly answers "should a wall panel default to the room it hangs in" — yes, and the mechanism to configure it per-device already exists (`kiosk-layout` in `localStorage`, `?layout=` override). Higher cost because HA's `/api/states` doesn't carry `area_id`; needs a second registry fetch (`/api/config/area_registry` + entity registry) to map entities to areas. | 8–12 | No new creds, but a second HA REST call class the app doesn't use today. |
| **4. Media player (transport + volume)** | High value *if* the household has Sonos/Chromecast/etc. in HA; unknown without asking the owner. Straightforward to mirror the light/switch pattern plus a volume action. | 5–7 | No, but value is contingent on the owner actually having `media_player.*` entities. |
| **5. Presence-based wake** | Nice quality-of-life (walk up, panel wakes) but low code cost since `wakeNight()` already exists and just needs a trigger source. | 2–3 (code only) | **Yes — needs a motion/presence sensor entity in HA**, which the owner may not have. Contingent on hardware, not just the HA token. |
| **6. Fan domain** | Mirrors the switch pattern almost exactly; lower household value than the above. | 3 | No. |
| **7. Vacuum domain** | Low value unless the owner has a robot vacuum; start/pause/dock + battery (battery display pattern already exists for sensors). | 3–4 | No, contingent on owning one. |
| **8. Camera/doorbell (deferred, do not start)** | Cheapest *useful* first cut, for when hardware lands: a single go2rtc snapshot/MJPEG endpoint + an HA event subscription (websocket, server-side) pushed to the kiosk via the same SSE pattern `/logs` already uses, surfacing a toast/modal on doorbell press — not full two-way video/WebRTC as the first version. | 10–15 (once hardware + go2rtc exist) | **Yes — hardware not installed, HA not configured.** Do not build against nothing to test. |

## Explicitly not worth doing

- **Camera/video streaming before hardware exists.** Already a deliberate,
  documented decision (task-board.md, design spec, PENDING-SETUP.md all
  agree) and it still holds: there is no backend to build or test against.
- **Bidirectional WS push replacing the 7s poll.** The `/smarthome` design
  doc already scoped this "Out" (§4) and the kiosk inherits the same
  7-second-poll contract; imperceptible for lights/climate, and new
  real-time infra contradicts PRODUCT.md's "no new runtime dependencies
  without reason" (`PRODUCT.md:26`).
- **Full HA automation editing.** Explicitly out of scope in the design doc
  (§4 "Out: … HA automations editing").
- **Per-user roles / OIDC-scoped HA permissions.** Deferred project-wide
  (`task-board.md:59`); this is a single-admin household, and the existing
  binary PIN model already matches "who's standing at the tablet," not
  "which named user is logged in" — adding roles would be solving a problem
  this household doesn't have.
- **Voice-triggered HA actions via Hermes.** The voice pipeline
  (`kiosk-voice.tsx`, `use-voice.ts`) only asks Hermes questions today — there
  is no intent-parsing or action-dispatch path from a transcript into
  `ha.ts`. Wiring that up duplicates the entire safety-boundary design above
  (what's voice-safe vs. what needs confirmation — "unlock the door" said by
  a delivery driver near an open mic is a real failure mode) and deserves its
  own dedicated pass rather than being folded into this one.

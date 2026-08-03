# Kiosk household-utility feature gap analysis

Lens: what household staples does a wall-mounted smart display need before it
earns its space next to (or instead of) a Nest Hub / Echo Show? Compared
against Nest Hub, Echo Show, DAKboard, MagicMirror², and Home Assistant wall
dashboards.

## Already built (cited)

- **Current conditions**: temp, feels-like, humidity, wind, precip, cloud
  cover, WMO icon/label — `src/lib/weather.ts:27-36` (`mapCurrent`,
  `weather.ts:191-203`).
- **5-day forecast**: max/min, rain %, sunrise/sunset per day —
  `weather.ts:38-47`, `weather.ts:205-220`.
- **Sunrise/sunset + live sun position**: real solar-elevation calc (NOAA
  algorithm) driving a day/night/dawn/dusk phase and a 0–1 progress value for
  UI chrome — `weather.ts:49-58`, `weather.ts:222-303`. This already covers
  the "sunrise-sunset" candidate from the brief; no separate widget needed.
- **Rain nowcast**: 15-min precip bars for the next ~90 min plus a 12-hour
  probability ribbon, with server-composed Melbourne-style microcopy ("rain in
  20 min, done by 3:40") — `weather.ts:60-69`, `weather.ts:305-411`, rendered
  in `src/components/kiosk-display.tsx:449-551`.
- **Morning briefing**: overnight Hermes digest (headline/body/action-needed)
  plus an LLM 3-bullet summary of configured RSS feeds — `src/lib/briefing.ts`
  end to end, rendered in `kiosk-display.tsx:584-662`. This already covers
  "commute/traffic/flight"-style ambient digest ground in spirit (a daily
  text summary), just not structured calendar/transit data.
- **Multi-timer kitchen panel**: presets + custom stepper, ring-gauge
  countdowns, two-tone Web Audio chime, `localStorage` persistence across
  reloads/background tabs — `src/components/kiosk-timers.tsx` (whole file;
  see THESIS comment at `kiosk-timers.tsx:3-19`). This already covers the
  "meal timer" half of meal planning.
- **Wall-clock glance layout**: `KioskClock` + one-line weather sentence +
  server-health sentence + (morning-only) briefing headline + up to 4
  auto-picked Home Assistant scene/light/switch tiles —
  `src/components/kiosk-glance.tsx` (whole file).
- **Night mode**: large clock + compact current-conditions, full-screen,
  tap-to-wake — `kiosk-display.tsx:686-728`.
- **Config surface**: `display.{lat,lon,place,timezone,newsFeeds}` is the only
  kiosk-specific config today — `src/lib/config.ts:87-93`. No calendar,
  list, or photo-source fields exist yet.

No calendar, task/shopping list, family note, bin-day, transit, package, or
photo-frame code exists anywhere in `src/` — confirmed by a repo-wide grep for
calendar/caldav/ical/shopping/todo/grocery/bin/waste/photo/screensaver/immich/
pigallery; every hit was an unrelated word match (e.g. "photo" inside
unrelated identifiers), not a feature.

## Category gap analysis vs Nest Hub / Echo Show / DAKboard

| Staple on category leaders | nightwatch today |
|---|---|
| Calendar / agenda (the #1 reason any household buys a wall display) | **Missing entirely.** No ICS/CalDAV fetch, no config field, no UI. |
| Shared shopping / to-do list (Alexa/Google list, DAKboard to-do widget) | **Missing.** |
| Photo frame / screensaver from a personal library | **Missing** — ironic, since the household already self-hosts Immich + PiGallery2 (per team-lead brief), a source Nest Hub users don't get without Google Photos. |
| Bin/waste-day, school-term, public-holiday reminders (DAKboard, MagicMirror² modules) | **Missing.** |
| Weather + forecast + rain radar-ish nowcast | **Exceeds the category** — the rain nowcast/summary microcopy is more granular than stock Nest Hub weather. |
| Daily news/briefing digest | **Exceeds the category** in one sense (LLM-summarized, personal Hermes digest) but has no calendar to sit next to. |
| Timers/alarms | **On par or better** — multi-timer with named presets is closer to a kitchen display than Echo Show's single-timer-per-name model. |
| Transit/commute | Missing; niche for a fixed household display outside peak commute households. |
| Now-playing / media control | Missing, despite Jellyfin already being a configured integration (`config.ts:43-48`, currently GPU-telemetry only). |
| Air quality / UV / pollen | Missing — `weather.ts` never requests Open-Meteo's separate air-quality endpoint, so this is a real gap, not something already returned and just unrendered. |

## Ranked proposals

| Feature | Data source | New deps? | Cost (hrs) | Value |
|---|---|---|---|---|
| Shared shopping / task list | `data/config.json`-style atomic JSON file, own `data/kiosk-lists.json`; new `/kiosk/api/lists` route | **None** — same `fs` + atomic tmp-rename pattern as `config.ts:171-181` | 4–6 | High — daily-use staple, cheapest structural build (mirrors `kiosk-timers.tsx`'s store pattern but server-persisted instead of `localStorage` so it isn't wiped by cache clearing) |
| Bin / waste collection reminder | No API — councils rarely expose one; model as a local recurrence rule (e.g. "general bin: Tuesdays, odd ISO week") computed with pure date math, config-driven like `display.*` | **None** | 2–3 | High — small, but a genuinely daily glance need with near-zero cost |
| Calendar / agenda via ICS subscription | Google/Outlook "secret iCal URL" (free, no OAuth) fetched server-side; hand-rolled `VEVENT`/`DTSTART`/`SUMMARY` extraction using the same regex-scoping technique `briefing.ts:137-153` already uses for RSS `<item>`/`<title>` | **None** for single/non-recurring events; **none but harder** for `RRULE` recurrence (daily/weekly patterns are tractable by hand, monthly/complex rules are not worth hand-rolling) | 8–12 (add 4–6 more for basic weekly recurrence) | Very high — the single most common wall-display feature category-wide, and the biggest visible gap |
| Air quality / UV index band | Open-Meteo's separate free, keyless Air Quality API (`air-quality-api.open-meteo.com`) — same fetch/cache shape as `weather.ts`, different endpoint | **None** | 3–4 | Medium-high — culturally relevant in Australia (UV index), cheap because it's the same client pattern already proven in `weather.ts` |
| Photo frame / screensaver | Immich or PiGallery2, both already self-hosted on the LAN (per household context) — a server route proxies a thumbnail/image list, client renders a slideshow; natural home is replacing/augmenting `KioskNightOverlay` (`kiosk-display.tsx:686-728`) | **None** if built with `<img>` cycling + `setInterval`; needs an Immich API key already possessed by the household (not a "credential they don't have") | 6–10 | High — differentiator nightwatch can uniquely offer (self-hosted, no Google Photos dependency) |
| Now-playing (Jellyfin) | Jellyfin `/Sessions` API — connection already configured in `config.json` (`config.ts:43-48`), currently used only for GPU transcode telemetry | **None** | 4–6 | Medium — reuses an existing credential/connection, so incremental cost is genuinely low |
| Family notes / whiteboard | Same JSON-file infra as the shopping list; a second list "kind" rather than a new subsystem | **None** | +1–2 on top of the list feature | Medium — fold into the shopping-list build rather than ship standalone |
| Meal planning + recipe display tied to timers | New data model (recipe steps, durations) plus a UI to browse/select and wire steps to `kiosk-timers.tsx`'s `addTimer()` | **None**, but non-trivial UI/data design | 10–14 | Medium — nice integration story with existing timers, but scope creeps fast (recipe source, editing UI) |

## Explicitly not worth doing

- **Transit / commute traffic**: no good free/keyless API for realistic
  Australian PTV-style data without registering for a developer key and
  handling GTFS-realtime feeds — disproportionate cost for a fixed wall
  display (most useful *leaving* the house, not glancing at it from the
  kitchen).
- **Flight tracking**: genuinely occasional need; doesn't justify permanent
  wall real estate or an integration budget. Better handled ad hoc (phone) the
  few times a year it matters.
- **Package/parcel tracking**: no unified free carrier API — realistically
  needs a paid aggregator (e.g. AfterShip) or scraping, which conflicts with
  the zero-new-runtime-deps constraint and the "keyless/free" bar every other
  kept feature clears.
- **School terms / public holidays as a standalone feature**: better solved
  as *entries in the calendar feature* (subscribe to a public AU holiday ICS
  feed alongside the personal calendar) than as separate bespoke code.
- **Chore rotation as its own subsystem**: no evidence of a multi-person
  rotation need distinct from a shared task list; building a rotation engine
  before there's a plain list would be solving an imagined problem.

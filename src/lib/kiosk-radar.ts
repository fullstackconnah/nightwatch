import { loadConfig } from "@/lib/config";

/**
 * Server-only BOM (Bureau of Meteorology) radar resolution for the kiosk's
 * "tap today's weather" loop (kiosk-radar.tsx / the two /kiosk/api/weather/radar
 * routes). Mirrors weather.ts's own contract: coordinates are read from
 * config and NEVER echoed to the client (see displayConfig() below and its
 * comment) — the LAN-facing kiosk gets a radar PRODUCT id and a place name,
 * never the owner's exact lat/lon.
 */

export interface RadarSite {
  /** BOM's own site id, no range digit — e.g. "IDR02" for Melbourne
   *  (Laverton). A product id is this plus RADAR_RANGE_DIGIT, e.g. "IDR023". */
  id: string;
  name: string;
  lat: number;
  lon: number;
}

// The eight capital-city radars, confirmed 2026-08 against
// https://www.bom.gov.au/australia/radar/ (that page's per-state site tables
// link each named location straight to its IDR id — these are copied from
// there, not guessed from memory). Lat/lon are the named locality's own
// coordinates, which is all "nearest radar" needs — sub-km precision doesn't
// matter at 128-256km radar range. Not all 60-odd BOM sites are here; the
// owner's own location (Pakenham, VIC) resolves correctly off Melbourne alone,
// and a national-capitals set is what the brief asked for ("enough to pick
// nearest sensibly").
export const RADAR_SITES: RadarSite[] = [
  { id: "IDR71", name: "Sydney (Terrey Hills)", lat: -33.6971, lon: 151.2117 },
  { id: "IDR02", name: "Melbourne (Laverton)", lat: -37.8675, lon: 144.7503 },
  { id: "IDR66", name: "Brisbane (Mt Stapylton)", lat: -27.7178, lon: 153.24 },
  { id: "IDR64", name: "Adelaide (Buckland Park)", lat: -34.6169, lon: 138.4689 },
  { id: "IDR70", name: "Perth (Serpentine)", lat: -32.3931, lon: 115.8677 },
  { id: "IDR76", name: "Hobart (Mt Koonya)", lat: -43.1122, lon: 147.8058 },
  { id: "IDR40", name: "Canberra (Captains Flat)", lat: -35.6055, lon: 149.4519 },
  { id: "IDR63", name: "Darwin (Berrimah)", lat: -12.4572, lon: 130.9256 },
];

/** BOM's range-product digit: 1="512km", 2="256km", 3="128km", 4="64km" (the
 *  same site broadcasts several zoom levels under the one id). 128km is the
 *  right default for this house: Pakenham sits ~65km from the Laverton site
 *  (confirmed by the nearestRadar() distance below), so 64km would clip the
 *  loop right at the owner's own doorstep, while 256km would spend most of
 *  the frame on country the forecast doesn't cover, at half the resolution
 *  for no benefit. Fixed rather than distance-adaptive because the two
 *  routes below only ever serve this one installation's own display config. */
export const RADAR_RANGE_DIGIT = "3";

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine great-circle distance in km — plenty accurate for choosing
 *  between radar sites hundreds of km apart. */
function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestRadar(lat: number, lon: number): RadarSite {
  let best = RADAR_SITES[0];
  let bestKm = Infinity;
  for (const site of RADAR_SITES) {
    const km = greatCircleKm(lat, lon, site.lat, site.lon);
    if (km < bestKm) {
      bestKm = km;
      best = site;
    }
  }
  return best;
}

export function radarProductId(site: RadarSite): string {
  return `${site.id}${RADAR_RANGE_DIGIT}`;
}

const PRODUCT_ID_RE = /^IDR\d{3}$/;

export interface RadarSelection {
  /** Full product id, e.g. "IDR023" — what both API routes key everything off. */
  product: string;
  /** Human label for attribution in the modal. "your area" when the product
   *  came from a config override this table has no matching site name for. */
  site: string;
}

/** Config-over-nearest, same precedence idiom as config.ts's systemSetting():
 *  an explicit `display.radarProduct` (validated) wins; nearestRadar() is the
 *  fallback every install without that field gets for free. `overrideRaw` is
 *  read defensively by the caller (config.ts's `display` type isn't owned by
 *  this feature — see configRadarOverride() below) rather than widening
 *  AppConfig itself. */
export function resolveRadarProduct(lat: number, lon: number, overrideRaw: unknown): RadarSelection {
  if (typeof overrideRaw === "string" && PRODUCT_ID_RE.test(overrideRaw)) {
    return { product: overrideRaw, site: "your area" };
  }
  const nearest = nearestRadar(lat, lon);
  return { product: radarProductId(nearest), site: nearest.name };
}

// --- frame timestamps ---------------------------------------------------

const FRAME_INTERVAL_MIN = 5;

/* Empirically measured against the live bom.gov.au host (2026-08-04/05, two
   probes ~2 minutes apart): available `IDR023.T.<ts>.png` frames land on a
   5-MINUTE grid offset 4 minutes past the hour — …:44, :49, :54, :59, :04,
   :09… — not the clean 6-minute-from-the-hour cadence this feature was
   originally briefed against. Verified by requesting a run of candidate
   timestamps and reading back 200 vs 404 (a 404 here is a ~23.8KB BOM error
   page, a hit is a several-KB PNG) — never assumed. Both probes' latest
   grid slot (rounded via the formula below) was already live with no extra
   publish lag observed, and the rolling buffer went back exactly 9 frames
   (40 minutes) before turning to 404 in both checks. If BOM ever changes this
   cadence, a stale FRAME_COUNT just means some requested frames 404 through
   the proxy — kiosk-radar.tsx's own loading/failure handling covers that,
   this isn't a hard dependency for anything else in the response. */
const GRID_OFFSET_MIN = 4;
const FRAME_COUNT = 10;

/* A THIRD probe (2026-08-04, ~10 min after the first two) found the
   theoretically-freshest grid slot (this-minute floored to the grid above)
   still 404ing while the ONE-STEP-OLDER slot was already live — so publish
   lag isn't always ~0 as the first two probes suggested; it varies, and can
   exceed one 5-minute step. PUBLISH_LAG_STEPS skips the newest grid slot
   entirely so "the newest frame this route offers" is the one BOM has
   already reliably published by the time a client requests it, rather than
   the one BOM's own schedule merely implies should exist by now. Frame
   preloading + the omit-on-404 handling in kiosk-radar.tsx's modal is the
   second line of defence if lag is ever worse than one step on a given day. */
const PUBLISH_LAG_STEPS = 1;

/** Largest-timestamp-first internal helper: floors `now` to the BOM grid
 *  described above, backs off PUBLISH_LAG_STEPS, then walks back `count`
 *  more steps. Returns oldest → newest (the shape the animated loop wants to
 *  play forward through, pausing on the last/newest entry). */
export function recentFrameTimestamps(now: Date = new Date(), count = FRAME_COUNT): string[] {
  const stepMs = FRAME_INTERVAL_MIN * 60_000;
  const offsetMs = GRID_OFFSET_MIN * 60_000;
  const flooredMs = Math.floor((now.getTime() - offsetMs) / stepMs) * stepMs + offsetMs;
  const latestGridMs = flooredMs - PUBLISH_LAG_STEPS * stepMs;
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(formatBomTimestamp(new Date(latestGridMs - i * stepMs)));
  }
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC "YYYYMMDDHHMM", the exact token BOM's own frame URLs use. */
function formatBomTimestamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`
  );
}

/** Inverse of formatBomTimestamp, as a proper ISO instant for the client. */
export function bomTimestampToIso(t: string): string {
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:00.000Z`;
}

// --- display config + public loop shape ----------------------------------

interface DisplayConfig {
  lat: number;
  lon: number;
  place: string;
}

/** Deliberately NOT imported from weather.ts (which doesn't export its own
 *  version) — same "own a small private copy rather than reach into a
 *  sibling module for something it never exposed" idiom kiosk-climate.tsx
 *  documents for itself. Identical null/trim rules to weather.ts's
 *  displayConfig() so the two features agree on what "configured" means. */
function displayConfig(): DisplayConfig | null {
  const d = loadConfig().display;
  if (!d || typeof d.lat !== "number" || typeof d.lon !== "number") return null;
  return { lat: d.lat, lon: d.lon, place: d.place?.trim() || "Home" };
}

/** `display.radarProduct` isn't a field AppConfig["display"] declares
 *  (config.ts is owned by another workstream) — read it defensively as
 *  unknown rather than widening that type, and validated fully in
 *  resolveRadarProduct() above before it's ever trusted. */
function configRadarOverride(): unknown {
  const d = loadConfig().display as { radarProduct?: unknown } | undefined;
  return d?.radarProduct;
}

export interface RadarLoop {
  product: string;
  site: string;
  place: string;
  /** Oldest → newest, BOM's own "YYYYMMDDHHMM" tokens. */
  frames: string[];
}

/** Null exactly when weather.ts's own getWeather() would report
 *  "unconfigured" — no `display` block, or one missing lat/lon. */
export function buildRadarLoop(now: Date = new Date()): RadarLoop | null {
  const cfg = displayConfig();
  if (!cfg) return null;
  const { product, site } = resolveRadarProduct(cfg.lat, cfg.lon, configRadarOverride());
  return { product, site, place: cfg.place, frames: recentFrameTimestamps(now) };
}

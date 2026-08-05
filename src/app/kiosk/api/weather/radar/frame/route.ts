import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 6000;
const PRODUCT_RE = /^IDR\d{3}$/;
const TIMESTAMP_RE = /^\d{12}$/;
const LAYERS = new Set(["background", "topography", "locations", "range"]);

// BOM 403s a bare/non-browser request but 200s a real Chrome UA over HTTPS
// (verified live: `curl -A "Mozilla/5.0 ..." https://www.bom.gov.au/products/
// radar_transparencies/IDR023.background.png` -> 200, image/png). Sending
// this from the server, never asking the client to, is the entire reason
// this proxy route exists.
const BOM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// How far a requested frame timestamp may sit from "now" before it's
// rejected. BOM's own rolling buffer only ever holds the last ~40-45 minutes
// (confirmed empirically against the live host — see kiosk-radar.ts's
// recentFrameTimestamps comment); a few hours of slack comfortably covers
// clock drift and a slow client without turning `t` into a means of walking
// years of archived frames through this route.
const MAX_AGE_MS = 3 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;

function timestampToMs(t: string): number {
  const y = Number(t.slice(0, 4));
  const mo = Number(t.slice(4, 6)) - 1;
  const d = Number(t.slice(6, 8));
  const h = Number(t.slice(8, 10));
  const mi = Number(t.slice(10, 12));
  return Date.UTC(y, mo, d, h, mi);
}

/**
 * Image proxy for the kiosk radar loop. Takes an opaque, strictly-validated
 * (product, layer|timestamp) pair — NEVER a caller-supplied URL or path
 * fragment. This is an unauthenticated LAN route (same /kiosk/api/* exemption
 * as weather/route.ts); accepting anything resembling a URL here would be an
 * open proxy onto whatever host a caller named. Every branch below builds the
 * upstream bom.gov.au path from parts that were already matched against a
 * fixed regex or an explicit allow-list, so the only strings that ever reach
 * `fetch()` are ones this route itself assembled from validated components.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const product = searchParams.get("product") ?? "";
  const layer = searchParams.get("layer");
  const t = searchParams.get("t");

  if (!PRODUCT_RE.test(product)) {
    return NextResponse.json({ error: "invalid product" }, { status: 400 });
  }

  let upstreamPath: string;
  let cacheControl: string;

  if (layer !== null) {
    if (!LAYERS.has(layer)) {
      return NextResponse.json({ error: "invalid layer" }, { status: 400 });
    }
    upstreamPath = `/products/radar_transparencies/${product}.${layer}.png`;
    // Background/topography/locations/range only change when BOM re-surveys
    // a site (effectively never) — safe to cache hard.
    cacheControl = "public, max-age=86400, immutable";
  } else if (t !== null) {
    if (!TIMESTAMP_RE.test(t)) {
      return NextResponse.json({ error: "invalid timestamp" }, { status: 400 });
    }
    const ms = timestampToMs(t);
    const now = Date.now();
    if (!Number.isFinite(ms) || ms < now - MAX_AGE_MS || ms > now + MAX_FUTURE_MS) {
      return NextResponse.json({ error: "timestamp out of range" }, { status: 400 });
    }
    upstreamPath = `/radar/${product}.T.${t}.png`;
    // Once BOM publishes a frame for a given timestamp its pixels never
    // change again — cache hard, same reasoning as the static layers above.
    cacheControl = "public, max-age=604800, immutable";
  } else {
    return NextResponse.json({ error: "missing layer or t" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://www.bom.gov.au${upstreamPath}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      headers: { "User-Agent": BOM_USER_AGENT },
    });
    if (!res.ok) {
      // Never forward BOM's own response body/status text — just the fact
      // that upstream failed.
      return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
    }
    const body = await res.arrayBuffer();
    return new NextResponse(body, { headers: { "Content-Type": "image/png", "Cache-Control": cacheControl } });
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
  }
}

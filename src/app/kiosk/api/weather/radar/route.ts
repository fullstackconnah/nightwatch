import { NextResponse } from "next/server";
import { bomTimestampToIso, buildRadarLoop } from "@/lib/kiosk-radar";

export const dynamic = "force-dynamic";

const CACHE_MS = 2 * 60 * 1000; // BOM's own frames refresh every ~5 min and ask
// clients not to hammer the site — a short server-side cache matches
// weather.ts's own module-level-cache idiom (10 min there; shorter here since
// this feed changes far more often).

/** Same shape family as GET /kiosk/api/weather: "ok" | "unconfigured" |
 *  "unreachable", matching the vocabulary the client already understands. */
type RadarResponse =
  | {
      status: "ok";
      product: string;
      place: string;
      site: string;
      layers: { background: string; topography: string; locations: string; range: string };
      frames: Array<{ at: string; url: string }>;
    }
  | { status: "unconfigured" }
  | { status: "unreachable" };

let cache: { at: number; data: RadarResponse } | null = null;

function frameUrl(product: string, params: string): string {
  return `/kiosk/api/weather/radar/frame?product=${product}&${params}`;
}

/**
 * Public radar-loop description for the kiosk's "tap today's weather" modal.
 * Same exemption as the rest of /kiosk/api/* (see middleware.ts's
 * PUBLIC_PATHS). Every `url` below points at THIS app's own frame proxy
 * route, never at bom.gov.au directly (see that route for why: BOM 403s a
 * non-browser User-Agent, and only the server can hold one). No lat/lon
 * appears anywhere in this response — buildRadarLoop() only ever returns a
 * product id, a site label and the same `place` string /kiosk/api/weather
 * already exposes.
 */
export async function GET() {
  try {
    if (cache && Date.now() - cache.at < CACHE_MS) {
      return NextResponse.json(cache.data, { headers: { "Cache-Control": "no-store" } });
    }

    const loop = buildRadarLoop();
    if (!loop) {
      // Not cached, exactly like getWeather()'s own "unconfigured" branch —
      // loadConfig() is already mtime-cached, so re-checking every call costs
      // nothing and a config save takes effect on the very next request.
      return NextResponse.json({ status: "unconfigured" } satisfies RadarResponse, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const data: RadarResponse = {
      status: "ok",
      product: loop.product,
      place: loop.place,
      site: loop.site,
      layers: {
        background: frameUrl(loop.product, "layer=background"),
        topography: frameUrl(loop.product, "layer=topography"),
        locations: frameUrl(loop.product, "layer=locations"),
        range: frameUrl(loop.product, "layer=range"),
      },
      frames: loop.frames.map((t) => ({ at: bomTimestampToIso(t), url: frameUrl(loop.product, `t=${t}`) })),
    };
    cache = { at: Date.now(), data };
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Public unauthenticated route — never let an unhandled error's stack or
    // message escape, same last-line-of-defense idiom as briefing/route.ts.
    return NextResponse.json({ status: "unreachable" } satisfies RadarResponse, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}

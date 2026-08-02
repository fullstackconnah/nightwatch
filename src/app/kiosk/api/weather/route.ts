import { NextResponse } from "next/server";
import { getWeather } from "@/lib/weather";

export const dynamic = "force-dynamic";

/**
 * Public weather + 5-day forecast for the ambient kiosk display. Same
 * exemption as the rest of /kiosk/api/* (see middleware.ts's PUBLIC_PATHS).
 * getWeather() already keeps lat/lon out of its response shape — nothing
 * here needs to re-sanitize before returning it. Explicit no-store on top of
 * `dynamic = "force-dynamic"`: the 10-minute freshness window is owned by
 * weather.ts's in-memory cache, not by any HTTP/CDN cache in front of it.
 */
export async function GET() {
  const result = await getWeather();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

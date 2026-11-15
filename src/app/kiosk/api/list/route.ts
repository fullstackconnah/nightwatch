import { NextRequest, NextResponse } from "next/server";
import { handleListGet } from "@/lib/kiosk-list-store";
import { displayTimeZone } from "./tz";

export const dynamic = "force-dynamic";

/** Public read for the wall's shared list (the "/kiosk" prefix is public in middleware.ts); served from memory. */
export async function GET(req: NextRequest) {
  const r = await handleListGet({ list: req.nextUrl.searchParams.get("list"), tz: displayTimeZone(), now: Date.now() });
  return NextResponse.json(r.json, { status: r.status });
}

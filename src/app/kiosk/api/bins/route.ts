import { NextResponse } from "next/server";
import { binsPayload, type BinsResponse } from "@/lib/bin-night";
import { loadConfig } from "@/lib/config";
import { localDateString } from "@/lib/local-time";
import { displayTimeZone } from "../list/tz";

export const dynamic = "force-dynamic";

/**
 * Public bin night for the ambient kiosk ("/kiosk" is public in middleware.ts): the next evening before a collection
 * and its bin names, or one of two bare statuses. binsPayload builds all three shapes, so nothing else of the config
 * (and no rule that fails its checker) can reach this response; an unreadable config is `error`, never a throw.
 */
export async function GET() {
  let body: BinsResponse;
  try {
    body = binsPayload(loadConfig().bins, localDateString(displayTimeZone()));
  } catch {
    body = { status: "error" };
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

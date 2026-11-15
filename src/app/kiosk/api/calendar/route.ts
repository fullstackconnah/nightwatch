import { NextResponse } from "next/server";
import { getCalendarResponse, type CalendarResponse } from "@/lib/calendar-feed";

export const dynamic = "force-dynamic";

/**
 * Public calendar agenda for the ambient kiosk ("/kiosk" is public in middleware.ts): today's and tomorrow's events from the
 * cached private feed, or one of two bare statuses. The private link, an upstream error and the feed's own text never reach
 * this response, and a failure is `error`, never a throw.
 */
export async function GET() {
  let body: CalendarResponse;
  try {
    body = await getCalendarResponse();
  } catch {
    body = { status: "error" };
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

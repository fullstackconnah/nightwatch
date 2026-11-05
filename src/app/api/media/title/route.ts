import type { NextRequest } from "next/server";
import { titleResponse } from "@/lib/media/routes";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts. The id is passed on encoded by the worker client.
export async function GET(req: NextRequest) {
  return titleResponse(req.nextUrl.searchParams.get("id"));
}

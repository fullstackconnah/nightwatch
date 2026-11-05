import { scanResponse } from "@/lib/media/routes";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts.
export async function POST() {
  return scanResponse();
}

import { libraryResponse } from "@/lib/media/routes";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts (not in PUBLIC_PATHS, not in the kiosk allowlist).
export async function GET() {
  return libraryResponse();
}

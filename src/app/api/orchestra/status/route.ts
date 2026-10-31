import { NextResponse, type NextRequest } from "next/server";
import { getOrchestraSnapshot } from "@/lib/orchestra";
import { requireFullSession } from "@/lib/orchestra-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireFullSession(req);
  if (denied) return denied;
  // Always 200 (see /api/hermes-ctl/status): an unreachable service is a snapshot state, and a real 401 would
  // make client.ts log the browser out.
  return NextResponse.json(await getOrchestraSnapshot());
}

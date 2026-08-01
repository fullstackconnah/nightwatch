import { NextResponse } from "next/server";
import { queryMountHistory, type GrowthRange } from "@/lib/metrics-history";

export const dynamic = "force-dynamic";

const VALID_RANGES: readonly GrowthRange[] = ["24h", "7d", "14d"];

function isRange(v: string | null): v is GrowthRange {
  return v !== null && (VALID_RANGES as readonly string[]).includes(v);
}

/** DISK-tab growth panel (G5): per-mount used-bytes series from metrics
 *  history. `mounts` is a comma-separated list the client already knows (its
 *  own /api/resources response), capped at 8 server-side too. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rangeParam = searchParams.get("range");
  const range: GrowthRange = isRange(rangeParam) ? rangeParam : "24h";

  const mounts = (searchParams.get("mounts") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 8);

  try {
    const result = await queryMountHistory(range, mounts);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "mount growth query failed" },
      { status: 502 },
    );
  }
}

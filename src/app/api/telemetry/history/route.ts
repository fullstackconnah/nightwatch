import { NextResponse } from "next/server";
import { queryMetricsHistory, type HistoryRange } from "@/lib/metrics-history";

export const dynamic = "force-dynamic";

const VALID_RANGES: readonly HistoryRange[] = ["1h", "24h", "7d"];

function isRange(v: string | null): v is HistoryRange {
  return v !== null && (VALID_RANGES as readonly string[]).includes(v);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rangeParam = searchParams.get("range");
  const range: HistoryRange = isRange(rangeParam) ? rangeParam : "1h";

  const containers = (searchParams.get("containers") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 4); // hard cap — matches the picker's own limit

  try {
    const result = await queryMetricsHistory(range, containers);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "metrics history query failed" },
      { status: 502 },
    );
  }
}

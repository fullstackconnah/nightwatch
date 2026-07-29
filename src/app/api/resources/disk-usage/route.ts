import { NextResponse } from "next/server";
import { scanDiskUsage } from "@/lib/disk-usage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const label = searchParams.get("disk");
  if (!label) {
    return NextResponse.json({ error: "missing disk label" }, { status: 404 });
  }
  const refresh = searchParams.get("refresh") === "1";

  try {
    const scan = await scanDiskUsage(label, { refresh });
    if (!scan) {
      return NextResponse.json({ error: `unknown disk label: ${label}` }, { status: 404 });
    }
    // A scan-level error/partial flag is returned as 200 so the UI can show it inline;
    // 502 is reserved for an unexpected throw (scanDiskUsage wraps its own failures).
    return NextResponse.json(scan);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "disk usage scan failed" },
      { status: 502 },
    );
  }
}

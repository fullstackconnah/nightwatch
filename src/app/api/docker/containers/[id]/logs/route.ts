import { NextRequest, NextResponse } from "next/server";
import { containerLogs } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tail = Math.min(Number(req.nextUrl.searchParams.get("tail")) || 200, 5000);
  try {
    return NextResponse.json({ logs: await containerLogs(id, tail) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "logs failed" },
      { status: 502 },
    );
  }
}

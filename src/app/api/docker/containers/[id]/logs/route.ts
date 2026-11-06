import { NextRequest, NextResponse } from "next/server";
import { isContainerId } from "@/lib/container-id";
import { containerLogs } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isContainerId(id)) return NextResponse.json({ error: "invalid container id" }, { status: 400 });
  const tail = Math.min(Math.max(1, Math.floor(Number(req.nextUrl.searchParams.get("tail"))) || 200), 5000);
  try {
    return NextResponse.json({ logs: await containerLogs(id, tail) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "logs failed" },
      { status: 502 },
    );
  }
}

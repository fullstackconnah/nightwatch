import { NextRequest, NextResponse } from "next/server";
import { clampLogsTail, isContainerId } from "@/lib/container-id";
import { containerLogs } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isContainerId(id)) return NextResponse.json({ error: "invalid container id" }, { status: 400 });
  const tail = clampLogsTail(req.nextUrl.searchParams.get("tail"));
  try {
    return NextResponse.json({ logs: await containerLogs(id, tail) });
  } catch (e) {
    console.error("docker logs failed", e);
    return NextResponse.json({ error: "Docker unreachable." }, { status: 502 });
  }
}

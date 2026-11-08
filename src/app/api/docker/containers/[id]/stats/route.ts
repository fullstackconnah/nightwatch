import { NextRequest, NextResponse } from "next/server";
import { isContainerId } from "@/lib/container-id";
import { containerStats } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isContainerId(id)) return NextResponse.json({ error: "invalid container id" }, { status: 400 });
  try {
    return NextResponse.json(await containerStats(id));
  } catch (e) {
    console.error("docker stats failed", e);
    const status = (e as { statusCode?: number }).statusCode === 404 ? 404 : 502;
    return NextResponse.json(
      { error: status === 404 ? "That container no longer exists." : "Docker unreachable." },
      { status },
    );
  }
}

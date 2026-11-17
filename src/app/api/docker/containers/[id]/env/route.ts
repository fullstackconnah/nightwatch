import { NextRequest, NextResponse } from "next/server";
import { docker } from "@/lib/docker";
import { envValue } from "@/lib/container-detail";
import { isContainerId } from "@/lib/container-id";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** One environment value per call, behind the session (not on the kiosk allow-list): the detail route sends names only. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isContainerId(id)) return NextResponse.json({ error: "invalid container id" }, { status: 400, headers: NO_STORE });
  const name = req.nextUrl.searchParams.get("name");
  if (!name || name.length > 256) return NextResponse.json({ error: "invalid name" }, { status: 400, headers: NO_STORE });
  try {
    const info = await docker.getContainer(id).inspect();
    const value = envValue(info.Config.Env || [], name);
    if (value === undefined) return NextResponse.json({ error: "No such variable." }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ name, value }, { headers: NO_STORE });
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode === 404 ? 404 : 502;
    console.error("docker inspect failed", e);
    return NextResponse.json(
      { error: status === 404 ? "That container no longer exists." : "Docker unreachable." },
      { status, headers: NO_STORE },
    );
  }
}

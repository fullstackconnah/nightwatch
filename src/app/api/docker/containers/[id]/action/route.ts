import { NextRequest, NextResponse } from "next/server";
import { containerAction, type ContainerAction } from "@/lib/docker";

export const dynamic = "force-dynamic";

const ACTIONS: ContainerAction[] = ["start", "stop", "restart"];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (!ACTIONS.includes(action as ContainerAction)) {
    return NextResponse.json({ error: "action must be start|stop|restart" }, { status: 400 });
  }
  try {
    await containerAction(id, action as ContainerAction);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : `${action} failed` },
      { status: 500 },
    );
  }
}

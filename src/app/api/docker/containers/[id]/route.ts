import { NextRequest, NextResponse } from "next/server";
import { hostname } from "node:os";
import { docker, listContainers, removeContainer } from "@/lib/docker";
import { shapeContainerDetail } from "@/lib/container-detail";
import { isContainerId } from "@/lib/container-id";
import { isDeadlineError } from "@/lib/docker-deadline";
import { removeDecision, removeErrorCopy } from "@/lib/container-remove";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isContainerId(id)) return NextResponse.json({ error: "invalid container id" }, { status: 400 });
  try {
    const info = await docker.getContainer(id).inspect();
    return NextResponse.json(shapeContainerDetail(info));
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode === 404 ? 404 : 502;
    console.error("docker inspect failed", e);
    return NextResponse.json(
      { error: status === 404 ? "That container no longer exists." : "Docker unreachable." },
      { status },
    );
  }
}

/** Removes a stopped container. Never forces and never drops volumes (REMOVE_OPTIONS). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isContainerId(id)) return NextResponse.json({ error: "invalid container id" }, { status: 400 });
  // Fresh read: the state and protection checks must see the container as it is now, not 2 s ago.
  const all = await listContainers(true).catch(() => null);
  const decision = removeDecision(all, id, hostname());
  if (!("ok" in decision)) return NextResponse.json({ error: decision.message }, { status: decision.status });
  const { target } = decision;
  try {
    await removeContainer(target.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = (e as { statusCode?: number }).statusCode;
    if (isDeadlineError(e)) {
      return NextResponse.json({ error: removeErrorCopy("TIMEOUT", target.name) }, { status: 504 });
    }
    if (status === 403 || status === 404 || status === 409) {
      return NextResponse.json({ error: removeErrorCopy(status, target.name) }, { status });
    }
    if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|ECONNRESET/.test(message)) {
      return NextResponse.json({ error: removeErrorCopy("ECONN", target.name) }, { status: 502 });
    }
    console.error("docker remove failed", e);
    return NextResponse.json({ error: removeErrorCopy(500, target.name) }, { status: 500 });
  }
}

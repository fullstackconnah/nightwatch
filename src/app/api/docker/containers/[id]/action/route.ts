import { NextRequest, NextResponse } from "next/server";
import {
  CONTAINER_ACTIONS,
  performContainerAction,
  type ContainerAction,
} from "@/lib/docker";

export const dynamic = "force-dynamic";

function isAction(value: unknown): value is ContainerAction {
  return CONTAINER_ACTIONS.includes(value as ContainerAction);
}

/**
 * Docker and the socket proxy both fail in ways that are precise but useless to
 * read: "getaddrinfo ENOTFOUND socket-proxy" is a correct description of a DNS
 * lookup and tells the person looking at the dashboard nothing about what to do.
 * Each branch here names the thing that is actually wrong; anything unrecognised
 * still passes the original message through rather than swallowing it.
 */
function explain(e: unknown, action: ContainerAction): string {
  const message = e instanceof Error ? e.message : String(e);
  const status = (e as { statusCode?: number }).statusCode;

  if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|ECONNRESET/.test(message)) {
    return "Can't reach the Docker socket proxy — check that the sidecar container is up.";
  }
  if (status === 403) {
    return `The socket proxy refused ${action}. It needs POST=1 and CONTAINERS=1 to allow container writes.`;
  }
  if (status === 404) return "That container no longer exists.";
  if (status === 409) return `Docker won't ${action} this container in its current state.`;
  if (status === 500) return `Docker failed to ${action} it: ${message}`;
  return message;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: unknown };
  if (!isAction(action)) {
    return NextResponse.json(
      { error: `action must be one of ${CONTAINER_ACTIONS.join("|")}` },
      { status: 400 },
    );
  }
  try {
    await performContainerAction(id, action);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // 304 is Docker's "already in that state" for start/stop/pause/unpause. It
    // is not an error the operator can act on — the container is where they
    // wanted it — so report success and let the next poll confirm.
    if ((e as { statusCode?: number }).statusCode === 304) {
      return NextResponse.json({ ok: true, noop: true });
    }
    const status = (e as { statusCode?: number }).statusCode;
    return NextResponse.json(
      { error: explain(e, action) },
      { status: status === 404 || status === 403 || status === 409 ? status : 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { hostname } from "node:os";
import { findTarget, isProtectedContainer, LOOKUP_FAILED_MESSAGE, PROTECTED_MESSAGE, protectedActionRefused } from "@/lib/protected-containers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { busyMessage, guardsMinecraftStart, isBusy, isGuardedAction, tryBegin } from "@/lib/minecraft-busy";
import { isContainerId } from "@/lib/container-id";
import {
  CONTAINER_ACTIONS,
  listContainers,
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
 * gets a fixed line (the detail is logged by the caller, never returned).
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
  if (status === 500) return `Docker failed to ${action} it.`;
  return "Docker action failed.";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isContainerId(id)) return NextResponse.json({ error: "invalid container id" }, { status: 400 });
  const { action } = ((await req.json().catch(() => null)) ?? {}) as { action?: unknown };
  if (!isAction(action)) {
    return NextResponse.json(
      { error: `action must be one of ${CONTAINER_ACTIONS.join("|")}` },
      { status: 400 },
    );
  }
  // Same test the kiosk-elevation middleware and hermes-ctl/run use: a real session cookie means a full session.
  const hasSession = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (protectedActionRefused(action, hasSession, true)) {
    // id may be a short id or a name. A failed lookup fails closed (503); an unknown id falls through to Docker's 404.
    const all = await listContainers().catch(() => null);
    if (!all) return NextResponse.json({ error: LOOKUP_FAILED_MESSAGE }, { status: 503 });
    const target = findTarget(all, id);
    if (target && isProtectedContainer(target, hostname())) {
      return NextResponse.json({ error: PROTECTED_MESSAGE }, { status: 409 });
    }
  }
  // Starting the Minecraft server mid-restore would boot on half-written world files; stop stays open.
  const lookup = isGuardedAction(action) ? await listContainers().catch(() => null) : null;
  // A failed lookup fails open, except while a job holds the guard. Only start and restart look up or get refused.
  if (!lookup && isBusy() && isGuardedAction(action)) return NextResponse.json({ error: LOOKUP_FAILED_MESSAGE }, { status: 503 });
  const isMc = guardsMinecraftStart(action, lookup ? findTarget(lookup, id)?.name : undefined);
  const release = isMc ? tryBegin("start") : () => {};
  if (!release) return NextResponse.json({ error: busyMessage() }, { status: 409 });
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
    console.error("docker action failed", id, action, e);
    return NextResponse.json(
      { error: explain(e, action) },
      { status: status === 404 || status === 403 || status === 409 ? status : 500 },
    );
  } finally {
    release();
  }
}

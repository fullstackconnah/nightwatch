import { NextRequest, NextResponse } from "next/server";
import { PRUNE_TARGETS, pruneReclaimable, type PruneTarget } from "@/lib/docker";

export const dynamic = "force-dynamic";

// Auth: like every other /api/docker/* write (see containers/[id]/action/route.ts),
// this route carries no auth check of its own — src/middleware.ts already gates
// every /api/* path behind the admin session cookie except /api/auth/login, so a
// per-route check here would be redundant, not additional safety.

function isPruneTarget(value: unknown): value is PruneTarget {
  return PRUNE_TARGETS.includes(value as PruneTarget);
}

/**
 * Mirrors containers/[id]/action/route.ts's explain(): the socket-proxy's own
 * errors are correct but not actionable on their own, so translate the ones an
 * operator can actually do something about.
 */
function explain(e: unknown, target: PruneTarget): string {
  const message = e instanceof Error ? e.message : String(e);
  const status = (e as { statusCode?: number }).statusCode;

  if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|ECONNRESET/.test(message)) {
    return "Can't reach the Docker socket proxy — check that the sidecar container is up.";
  }
  if (status === 403) {
    const scope = target === "images" ? "IMAGES=1" : "VOLUMES=1";
    return `The socket proxy refused to prune ${target}. It needs POST=1 and ${scope} to allow this.`;
  }
  if (status === 500) return `Docker failed to prune ${target}: ${message}`;
  return message;
}

export async function POST(req: NextRequest) {
  const { target } = (await req.json().catch(() => ({}))) as { target?: unknown };
  if (!isPruneTarget(target)) {
    return NextResponse.json(
      { error: `target must be one of ${PRUNE_TARGETS.join("|")}` },
      { status: 400 },
    );
  }
  try {
    const result = await pruneReclaimable(target);
    return NextResponse.json(result);
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return NextResponse.json(
      { error: explain(e, target) },
      { status: status === 403 ? status : 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { docker, removeImage } from "@/lib/docker";

export const dynamic = "force-dynamic";

// Auth: like every other /api/docker/* write, this route carries no auth check
// of its own — src/middleware.ts already gates every /api/* path behind the
// admin session cookie (matcher excludes only static assets), so a per-route
// check here would be redundant, not additional safety.

/**
 * Mirrors prune/route.ts and containers/[id]/action/route.ts's explain(): the
 * socket-proxy's own errors are correct but not actionable on their own.
 * Verified empirically 2026-08-01: production's proxy already carries POST=1 +
 * IMAGES=1, so DELETE /images/{id} passes there — this 403 branch is the honest
 * story for a proxy that hasn't (the test stack's read-only POST=0 proxy, or any
 * future deployment that dials the scopes back).
 */
function explain(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const status = (e as { statusCode?: number }).statusCode;

  if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|ECONNRESET/.test(message)) {
    return "Can't reach the Docker socket proxy — check that the sidecar container is up.";
  }
  if (status === 403) {
    return "The socket proxy refused to delete this image. It needs POST=1 and IMAGES=1 to allow image removal.";
  }
  if (status === 404) return "That image no longer exists.";
  if (status === 409) return "Docker won't delete this image — a container is still using it.";
  if (status === 500) return `Docker failed to delete it: ${message}`;
  return message;
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    // Defensive re-check: the UI already renders the delete action disabled on
    // an in-use image, but a second tab or a stale 30s poll could still send
    // one through — name the owning container(s) rather than let Docker's own
    // opaque 409 be the only answer.
    const containers = await docker.listContainers({ all: true });
    const owners = containers
      .filter((c) => c.ImageID === id)
      .map((c) => (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, ""));
    if (owners.length > 0) {
      return NextResponse.json(
        {
          error: `In use by ${owners.join(", ")} — stop ${owners.length === 1 ? "it" : "them"} first.`,
        },
        { status: 409 },
      );
    }

    const result = await removeImage(id);
    return NextResponse.json(result);
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return NextResponse.json(
      { error: explain(e) },
      { status: status === 404 || status === 403 || status === 409 ? status : 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createStreamSlots, releaseOnEnd } from "@/lib/stream-slots";
import { isProxyableCamera, openCamera, type CameraMode } from "@/lib/ha-doorbell";

export const dynamic = "force-dynamic";

/**
 * Camera bytes for the kiosk's front-door modal, proxied so the Home
 * Assistant long-lived token never reaches the tablet.
 *
 * This route is unauthenticated on the LAN (see middleware.ts), so the
 * allowlist is the whole security story: `isProxyableCamera` re-derives the
 * door-camera set from HA on every request and refuses anything else, which
 * means an indoor camera in the same HA instance is not reachable here even
 * with a correctly-spelled entity_id. See src/lib/ha-doorbell.ts's header for
 * why that boundary sits in the resolver rather than in a constant.
 *
 * `mode=stream` returns HA's MJPEG multipart response untouched, straight into
 * an <img> on the client. `mode=snapshot` returns one JPEG — the fallback for
 * a camera whose stream the browser won't render, polled by the client with a
 * changing query string.
 */

const ENTITY_ID_RE = /^camera\.[a-zA-Z0-9_]+$/;

// Open MJPEG streams across all callers; each holds an upstream HA connection.
const slots = createStreamSlots(3);

export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get("entity") ?? "";
  const mode: CameraMode = req.nextUrl.searchParams.get("mode") === "snapshot" ? "snapshot" : "stream";

  if (!ENTITY_ID_RE.test(entityId)) {
    return NextResponse.json({ error: "entity must be a camera.<object_id> entity_id" }, { status: 400 });
  }
  if (!(await isProxyableCamera(entityId))) {
    // 404, not 403: to anything that isn't the front door camera, this route
    // does not exist. There is no signal here about what else HA might hold.
    return NextResponse.json({ error: "No such door camera." }, { status: 404 });
  }

  const release = mode === "stream" ? slots.acquire() : undefined;
  if (mode === "stream" && !release) {
    return NextResponse.json({ error: "Too many open camera streams." }, { status: 429 });
  }
  // Release is idempotent; every exit below calls it, so the count returns once per stream.
  req.signal.addEventListener("abort", release ?? (() => {}), { once: true });

  const upstream = await openCamera(entityId, mode, req.signal).catch((e) => {
    release?.();
    throw e;
  });
  if ("error" in upstream) {
    release?.();
    return NextResponse.json({ error: upstream.error }, { status: upstream.status });
  }

  let body: BodyInit | null = upstream.body;
  if (release && upstream.body) {
    body = releaseOnEnd(upstream.body, release);
  } else release?.();

  return new Response(body, {
    status: 200,
    headers: {
      // Copied from upstream rather than reconstructed: the multipart boundary
      // is part of this header and differs per integration (measured:
      // "ffmpeg" for the Ring camera, "--frameboundary" for the Reolink one).
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "no-store, no-transform",
      // The kiosk is reachable through Nginx Proxy Manager, which buffers
      // proxied responses by default — on an MJPEG stream that shows up as a
      // picture that never arrives. This is the documented opt-out.
      "X-Accel-Buffering": "no",
    },
  });
}

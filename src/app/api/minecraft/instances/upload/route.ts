import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { crossSiteWriteRefused } from "@/lib/same-origin";
import { busyMessage, tryBegin } from "@/lib/minecraft-busy";
import { sanitizeSlug } from "@/lib/minecraft/slug";
import { mcManagerCredentials } from "@/lib/minecraft/manager";
import { guardedUpload } from "@/lib/minecraft/upload-proxy";
import { MAX_MEMORY_GB, memoryGbInRange } from "@/lib/minecraft/memory-gb";
import { uploadFieldsError } from "@/lib/minecraft/pack-check";
import { contentLengthError } from "@/lib/upload-limit";

export const dynamic = "force-dynamic";

// The manager's own UPLOAD_MAX_BYTES.
const PACK_MAX_BYTES = 2 * 1024 ** 3;

const VALID_LOADERS = new Set(["forge", "neoforge", "fabric"]);

/**
 * Proxies a CurseForge "Server Pack" zip upload straight through to
 * mc-manager's `POST /instances/upload` — metadata as query params (mirrored
 * onto the upstream URL untouched), the zip as the request body.
 *
 * The body is forwarded as a raw stream (`body: req.body`) rather than
 * parsed with `req.formData()` — a 300MB server pack must never be buffered
 * fully into this Next process's memory just to be re-serialized. `duplex:
 * "half"` is required by undici's fetch whenever the request body is a
 * ReadableStream; there's no equivalent flag in the DOM RequestInit type
 * this TypeScript version ships, hence the cast.
 */
export async function POST(req: NextRequest) {
  // Excluded from the middleware matcher (see middleware.ts), so check origin
  // and authenticate here, before the body or upstream is touched.
  if (crossSiteWriteRefused(req.method, req.headers)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
  if (!(await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const creds = mcManagerCredentials();
  if (!creds) {
    return NextResponse.json(
      { error: "Minecraft manager is not configured — add managerUrl and managerToken in Settings → Integrations." },
      { status: 409 },
    );
  }

  const params = req.nextUrl.searchParams;
  const rawSlug = params.get("slug")?.trim();
  const name = params.get("name")?.trim();
  const mcVersion = params.get("mcVersion")?.trim();
  const loader = params.get("loader")?.trim();

  if (!rawSlug || !name || !mcVersion || !loader) {
    return NextResponse.json({ error: "slug, name, mcVersion, and loader are required" }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "name must be at most 100 characters" }, { status: 400 });
  }
  const loaderVersion = params.get("loaderVersion")?.trim();
  const fieldsError = uploadFieldsError(mcVersion, loaderVersion);
  if (fieldsError) return NextResponse.json({ error: fieldsError }, { status: 400 });
  if (!VALID_LOADERS.has(loader)) {
    return NextResponse.json(
      { error: `loader must be one of ${[...VALID_LOADERS].join(", ")}` },
      { status: 400 },
    );
  }

  const memoryGb = params.get("memoryGb");
  if (memoryGb !== null && !memoryGbInRange(Number(memoryGb))) {
    return NextResponse.json({ error: `memoryGb must be above 0 and at most ${MAX_MEMORY_GB}` }, { status: 400 });
  }

  const contentType = req.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "Send the pack as a multipart form upload." }, { status: 400 });
  }
  const tooBig = contentLengthError(req.headers.get("content-length"), PACK_MAX_BYTES, "The pack");
  if (tooBig) return NextResponse.json({ error: tooBig.detail }, { status: tooBig.status });

  // Only the six known fields go upstream, never the caller's whole query string.
  const query = new URLSearchParams({ slug: sanitizeSlug(rawSlug), name, mcVersion, loader });
  if (loaderVersion) query.set("loaderVersion", loaderVersion);
  if (memoryGb !== null) query.set("memoryGb", String(Number(memoryGb)));
  const upstreamUrl = `${creds.url}/instances/upload?${query.toString()}`;

  const release = tryBegin("upload");
  if (!release) return NextResponse.json({ error: busyMessage() }, { status: 409 });
  // guardedUpload releases the guard, or holds it when our wait timed out.
  const { status, body } = await guardedUpload(release, () =>
    fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": contentType,
      },
      body: req.body,
      signal: AbortSignal.timeout(10 * 60 * 1000),
      // Node's fetch requires this whenever body is a stream — no matching
      // field exists on the DOM RequestInit type, hence the cast.
      duplex: "half",
    } as RequestInit & { duplex: "half" }),
  );
  return NextResponse.json(body, { status });
}

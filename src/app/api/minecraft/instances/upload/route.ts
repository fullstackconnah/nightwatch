import { NextRequest, NextResponse } from "next/server";
import { mcManagerCredentials } from "@/lib/minecraft/manager";

export const dynamic = "force-dynamic";

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
  const creds = mcManagerCredentials();
  if (!creds) {
    return NextResponse.json(
      { error: "Minecraft manager is not configured — add managerUrl and managerToken in Settings → Integrations." },
      { status: 409 },
    );
  }

  const params = req.nextUrl.searchParams;
  const slug = params.get("slug")?.trim();
  const name = params.get("name")?.trim();
  const mcVersion = params.get("mcVersion")?.trim();
  const loader = params.get("loader")?.trim();

  if (!slug || !name || !mcVersion || !loader) {
    return NextResponse.json({ error: "slug, name, mcVersion, and loader are required" }, { status: 400 });
  }
  if (!VALID_LOADERS.has(loader)) {
    return NextResponse.json(
      { error: `loader must be one of ${[...VALID_LOADERS].join(", ")}` },
      { status: 400 },
    );
  }

  const contentType = req.headers.get("content-type");
  if (!contentType) {
    return NextResponse.json({ error: "content-type is required" }, { status: 400 });
  }

  const upstreamUrl = `${creds.url}/instances/upload?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": contentType,
      },
      body: req.body,
      // Node's fetch requires this whenever body is a stream — no matching
      // field exists on the DOM RequestInit type, hence the cast.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "mc-manager did not respond" },
      { status: 502 },
    );
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : `mc-manager returned HTTP ${res.status}`;
    return NextResponse.json({ error: detail }, { status: res.status });
  }

  return NextResponse.json(body, { status: res.status });
}

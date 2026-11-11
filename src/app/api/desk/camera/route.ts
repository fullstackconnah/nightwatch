import { loadConfig, systemSetting } from "@/lib/config";
import { createFrameCache, deskCameraResponse, doorCameraEntity } from "@/lib/desk-camera";
import { getDoorbellSnapshot, openCamera } from "@/lib/ha-doorbell";

export const dynamic = "force-dynamic";

const cache = createFrameCache((entity, signal) => openCamera(entity, "snapshot", signal));

/**
 * The desk widget's door-camera frame. Same bearer as the glance plus system.deskCamera, both read
 * per request; exempted from the session gate by one exact-path check in middleware.ts. No query or
 * path input: the camera is viewCamera ?? the first door camera. Every non-200 body is empty.
 */
export async function GET(req: Request) {
  try {
    const r = await deskCameraResponse({
      deskToken: systemSetting("deskToken", "DESK_TOKEN"),
      mcpToken: systemSetting("mcpToken", "MCP_TOKEN"),
      authorization: req.headers.get("authorization"),
      flag: () => loadConfig().system?.deskCamera === true,
      resolve: async () => doorCameraEntity(await getDoorbellSnapshot()),
      cache,
    });
    return new Response(r.body as BodyInit | null, { status: r.status, headers: r.headers });
  } catch {
    // a config read that throws must not become a Next 500 page
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

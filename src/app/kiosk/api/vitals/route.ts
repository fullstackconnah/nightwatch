import { getHostVitals } from "@/lib/host-metrics";
import { throwingSnapshotRoute } from "@/lib/snapshot-route";

export const dynamic = "force-dynamic";

/**
 * Public read-only host vitals for the ambient kiosk display. Deliberately a
 * separate route from /api/host rather than reusing it: that route sits behind
 * the normal session gate, and this one is intentionally exempted in
 * middleware.ts (PUBLIC_PATHS matches "/kiosk", which covers "/kiosk/api/*") so
 * a wall tablet can show vitals without an admin session. Returns the same
 * numbers /api/host does — never logs, secrets, or container detail.
 *
 * Both routes now read through the same 2s memo in host-metrics.ts, so a desk
 * browser and a wall tablet polling together cost ONE collection, not two.
 *
 * Off the always-200 contract for the same reason /api/host is — see there.
 */
export const GET = throwingSnapshotRoute({ collect: getHostVitals }, 502, "host metrics unavailable");

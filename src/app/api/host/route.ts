import { getHostVitals } from "@/lib/host-metrics";
import { throwingSnapshotRoute } from "@/lib/snapshot-route";

export const dynamic = "force-dynamic";

/**
 * NOT on the always-200 contract, deliberately: HostVitals has no failure
 * variant to carry a message in, so a collection failure has nowhere to go but
 * the status code. useHost already renders a non-200 here as "unreachable".
 * See snapshot-route.ts's throwingSnapshotRoute comment.
 */
export const GET = throwingSnapshotRoute({ collect: getHostVitals }, 500, "host metrics failed");

import { collectCounts } from "@/lib/container-counts";
import { listContainers } from "@/lib/docker";
import { throwingSnapshotRoute } from "@/lib/snapshot-route";

export const dynamic = "force-dynamic";

// 502 with a fixed text; the real error is logged server-side only. Counts: see container-counts.ts.
export const GET = throwingSnapshotRoute({ collect: () => collectCounts(listContainers) }, 502, "docker unreachable");

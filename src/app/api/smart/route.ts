import { getSmartSnapshot } from "@/lib/smart";
import { snapshotRoute } from "@/lib/snapshot-route";

export const dynamic = "force-dynamic";

// Always 200 — see snapshot-route.ts for the contract and why it matters.
export const GET = snapshotRoute({ collect: getSmartSnapshot });

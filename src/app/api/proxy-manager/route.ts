import { getProxyManagerSnapshot } from "@/lib/npm";
import { snapshotRoute } from "@/lib/snapshot-route";

export const dynamic = "force-dynamic";

// Always 200 — see snapshot-route.ts. NPM's own credentials never reach the
// client (see ProxyManagerSnapshot).
export const GET = snapshotRoute({ collect: getProxyManagerSnapshot });

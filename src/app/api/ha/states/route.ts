import { getHaStates } from "@/lib/ha";
import { snapshotRoute } from "@/lib/snapshot-route";

export const dynamic = "force-dynamic";

// Always 200 — see snapshot-route.ts. Crucially this must never be a real HTTP
// 401 even for HA's own "unauthorized" case: client.ts's `fetcher` reads a 401
// as THIS app's session expiring and redirects to /login, which would be wrong
// here — the dashboard session is fine, HA's token isn't. src/lib/ha.ts's
// HaClient returns a Probe rather than a Response so that cannot happen.
export const GET = snapshotRoute({ collect: getHaStates });

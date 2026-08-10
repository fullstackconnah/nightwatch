import { NextResponse } from "next/server";

/**
 * The always-200 read-only route contract, in one place.
 *
 * Six routes were structurally identical — `export const dynamic =
 * "force-dynamic"` plus `return NextResponse.json(await getXSnapshot())` —
 * each carrying its own paragraph explaining the same rule, four of which
 * literally said "mirrors /api/…". The rule:
 *
 *   A collection failure is a valid SNAPSHOT STATE the UI renders, not a
 *   transport failure. The route answers 200 with a payload whose own
 *   `status`/`error` field carries the bad news.
 *
 * This is not stylistic. src/lib/client.ts's `fetcher` treats any 401 as THIS
 * app's session expiring and redirects to /login, so a route that forwarded an
 * upstream's 401 would log the user out because somebody else's token expired
 * (see integration-client.ts, which enforces the same invariant one layer
 * down). Keeping every read-only route on 200 means there is exactly one
 * thing a 401 can mean, everywhere in the app.
 *
 * Auth for these routes is handled globally by middleware.ts, which gates
 * every /api/** path except the public login and /kiosk routes. Nothing extra
 * is needed per route.
 */
export interface SnapshotSource<T> {
  collect(): Promise<T>;
}

export type SnapshotHandler = () => Promise<NextResponse>;

/**
 * Builds the GET handler for a read-only snapshot route.
 *
 * The route file still needs its own `export const dynamic = "force-dynamic"`
 * — Next reads that as a static export from the module, so it cannot be
 * supplied by a factory.
 *
 * ```ts
 * export const dynamic = "force-dynamic";
 * export const GET = snapshotRoute({ collect: getSmartSnapshot });
 * ```
 */
export function snapshotRoute<T>(source: SnapshotSource<T>): SnapshotHandler {
  return async () => NextResponse.json(await source.collect());
}

/**
 * For collectors that can still throw rather than returning a failure state of
 * their own — currently the host/docker ones, whose snapshot types have no
 * "something went wrong" variant to put the message in.
 *
 * `errorStatus` keeps their existing non-200 behaviour explicit and visible
 * rather than letting it drift: /api/host has always answered 500 and the two
 * public kiosk routes 502, and their clients (useHost, useKioskVitals,
 * useKioskHealth) already render that as "unreachable". Changing it would mean
 * inventing an error variant for HostVitals, which is a bigger change than
 * this consolidation should smuggle in.
 */
export function throwingSnapshotRoute<T>(
  source: SnapshotSource<T>,
  errorStatus: number,
  fallbackMessage: string,
): SnapshotHandler {
  return async () => {
    try {
      return NextResponse.json(await source.collect());
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : fallbackMessage },
        { status: errorStatus },
      );
    }
  };
}

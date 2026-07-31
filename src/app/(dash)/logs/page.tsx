/*
  DIRECTION CONTRACT — /logs

  THESIS: Each watched container owns a stable full-width band, so a rare line
  arriving is noticed by position. Refuses the merged single stream, where one
  chatty container relocates everything else.

  OWN-WORLD: nightwatch as built — #070b11 ground, hairline .panel surfaces, teal
  phosphor accent, mono numerals, 10px microlabels, status dots. No new palette.

  STORY: The reader learns which containers they are watching from the emptied
  sockets on the rail, reads a track that is honestly quiet, and catches an
  arrival without staring at it.

  FIRST VIEWPORT: Title and live line rate; the 26-container rail, grouped by
  compose stack, selected chips hollowed out; the filter row (regex, five level
  pills, ANSI); then stacked tracks. Primary action is a chip on the rail.

  FORM: Stacked full-width tracks — candidate 3 of the ordered list, seed key
  0d978e32. Staging committed: perimeter rail whose gap means in-use.

  FINISH: unreviewed and undocumented is unfinished; this build ends with the
  finish review, the verdict, and DESIGN.md
*/

import { listContainers } from "@/lib/docker";
import { LogConsole } from "@/components/log-console";
import type { RailContainer } from "@/components/container-rail";

export const dynamic = "force-dynamic";

export const metadata = { title: "Logs · nightwatch" };

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;

  let containers: RailContainer[] = [];
  let error: string | null = null;
  try {
    const all = await listContainers();
    containers = all
      .map((x) => ({
        name: x.name,
        state: x.state,
        health: x.health,
        composeProject: x.composeProject,
      }))
      // Running first, then alphabetical inside each group: a stopped container
      // is worth reading (that is where an exit reason lives) but is never the
      // thing you reach for first.
      .sort((a, b) => {
        const ar = a.state === "running" ? 0 : 1;
        const br = b.state === "running" ? 0 : 1;
        return ar !== br ? ar - br : a.name.localeCompare(b.name);
      });
  } catch (err) {
    error = err instanceof Error ? err.message : "could not reach the docker socket";
  }

  const initialSelection = (c ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (error) {
    return (
      <div className="panel p-5">
        <h1 className="text-lg font-semibold tracking-tight">Logs</h1>
        <p className="text-sm text-ink-dim mt-2">
          The container list could not be read, so there is nothing to stream from.
        </p>
        <p className="font-mono text-xs text-bad mt-2">{error}</p>
        {/* An error state that only names the problem is a dead end on a page you
            cannot otherwise use. Both recoveries are real: this is nearly always
            the socket proxy being down, and a plain anchor forces a full reload
            rather than a soft navigation that would replay the same cached failure. */}
        <p className="text-xs text-ink-faint mt-4">
          The dashboard reaches docker through the socket-proxy container — check that it is
          running, then try again.
        </p>
        <div className="flex items-center gap-3 mt-3">
          <a
            href="/logs"
            className="panel panel-hover inline-flex items-center h-11 md:h-9 px-3 text-xs text-ink"
          >
            Try again
          </a>
          <a
            href="/containers"
            className="inline-flex items-center h-11 md:h-9 text-xs text-ink-faint hover:text-ink transition-colors"
          >
            Container list
          </a>
        </div>
      </div>
    );
  }

  return <LogConsole containers={containers} initialSelection={initialSelection} />;
}

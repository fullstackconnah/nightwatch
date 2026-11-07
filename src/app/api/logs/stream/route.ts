import { readContainerLogTail, subscribeContainerLogs } from "@/lib/log-stream";
import { goLive } from "@/lib/sse-live";
import { parseResume, staleResumeNames } from "@/lib/log-reconnect";
import {
  LOG_TAIL_DEFAULT,
  MAX_TRACKS,
  type LogLine,
  type LogSeedEvent,
  type LogTrackState,
} from "@/lib/types/log";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
const MAX_TAIL = 2000;

function clampTail(raw: string | null): number {
  if (raw === null) return LOG_TAIL_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return LOG_TAIL_DEFAULT;
  return Math.min(MAX_TAIL, Math.max(0, n));
}

function splitNames(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tail = clampTail(url.searchParams.get("tail"));
  // Cap at MAX_TRACKS; ignore extras rather than reject the request.
  const names = splitNames(url.searchParams.get("c")).slice(0, MAX_TRACKS);
  // resume=name:lastTs,... marks a reconnect after a restart; only newer lines are replayed.
  const resumeRaw = url.searchParams.get("resume");
  const resumeFrom = parseResume(resumeRaw, Date.now());
  // A resume point too old to replay gets the normal tail, so the buffer has no silent gap.
  const seedRequested = new Set([...splitNames(url.searchParams.get("seed")), ...staleResumeNames(resumeRaw, resumeFrom)]);
  // Preserve `c`'s order for seeding, and only seed names that are actually tracked.
  const seedNames = names.filter((n) => seedRequested.has(n));

  const encoder = new TextEncoder();
  const unsubscribes: (() => void)[] = [];
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  // Shared teardown reached from three places: request abort, stream cancel(), and a
  // failed enqueue (client gone but abort hasn't propagated yet). Must be idempotent —
  // an orphaned subscriber would otherwise keep a `docker logs --follow` open forever
  // after a tab closes.
  const teardown = () => {
    if (closed) return;
    closed = true;
    for (const unsubscribe of unsubscribes) unsubscribe();
    unsubscribes.length = 0;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (request.signal.aborted) {
        teardown();
        return;
      }

      // Registered before any await below, so an abort arriving mid-seed still tears
      // down cleanly instead of only being noticed after every seed read finishes.
      request.signal.addEventListener("abort", teardown, { once: true });

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed underneath us — treat as teardown, not a crash.
          teardown();
        }
      };

      // Seed scrollback for each requested container BEFORE subscribing to live
      // lines, so no live line is ever delivered ahead of the scrollback it
      // belongs after. One bad container's seed failure is reported and skipped —
      // it must not take the rest of the stream down with it.
      for (const name of seedNames) {
        if (closed) break;
        try {
          const { lines, short } = await readContainerLogTail(name, tail);
          const payload: LogSeedEvent = { container: name, lines, short };
          safeEnqueue(`event: seed\ndata: ${JSON.stringify(payload)}\n\n`);
        } catch (err) {
          console.error(`log scrollback read failed for ${name}`, err);
          const state: LogTrackState = {
            container: name,
            status: "error",
            detail: `could not read scrollback`,
          };
          safeEnqueue(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
        }
      }

      // Resume replay goes out as plain `line` events, before going live. The
      // live feed attaches (tail 0) only after these reads, so a line logged
      // between a container's replay read and its attach can be lost; the reads
      // run in parallel to keep that window short.
      await Promise.all(
        names.map(async (name) => {
          const since = resumeFrom.get(name);
          if (since === undefined) return;
          try {
            const { lines } = await readContainerLogTail(name, 0, since);
            for (const line of lines) safeEnqueue(`event: line\ndata: ${JSON.stringify(line)}\n\n`);
          } catch {
            // Container briefly absent mid-recreate: the live subscribe below reports it.
          }
        }),
      );

      if (closed) return;

      // A subscribe callback can fail its enqueue and tear down mid-loop; goLive then
      // undoes the subscriptions instead of leaking them past teardown.
      const live = goLive(
        () => closed,
        () =>
          names.map((name) =>
            subscribeContainerLogs(
              name,
              (line: LogLine) => {
                safeEnqueue(`event: line\ndata: ${JSON.stringify(line)}\n\n`);
              },
              (state: LogTrackState) => {
                safeEnqueue(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
              },
            ),
          ),
        () => safeEnqueue(": ping\n\n"),
        HEARTBEAT_MS,
      );
      if (!live) return;
      unsubscribes.push(live.unsubscribe);
      heartbeatTimer = live.timer;
    },
    cancel() {
      teardown();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

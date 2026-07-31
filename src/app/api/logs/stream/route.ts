import { readContainerLogTail, subscribeContainerLogs } from "@/lib/log-stream";
import {
  LOG_TAIL_DEFAULT,
  MAX_TRACKS,
  type LogLine,
  type LogSeedEvent,
  type LogTrackState,
} from "@/lib/log-types";

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
  const seedRequested = new Set(splitNames(url.searchParams.get("seed")));
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
          const message = err instanceof Error ? err.message : String(err);
          const state: LogTrackState = {
            container: name,
            status: "error",
            detail: `could not read scrollback: ${message}`,
          };
          safeEnqueue(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
        }
      }

      if (closed) return;

      for (const name of names) {
        const unsubscribe = subscribeContainerLogs(
          name,
          (line: LogLine) => {
            safeEnqueue(`event: line\ndata: ${JSON.stringify(line)}\n\n`);
          },
          (state: LogTrackState) => {
            safeEnqueue(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
          },
        );
        unsubscribes.push(unsubscribe);
      }

      heartbeatTimer = setInterval(() => {
        safeEnqueue(": ping\n\n");
      }, HEARTBEAT_MS);
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

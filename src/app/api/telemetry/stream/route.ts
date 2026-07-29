import { getTelemetryHistory, subscribeTelemetry, type TelemetrySample } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

export async function GET(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  // Shared teardown reached from three places: request abort, stream cancel(), and a
  // failed enqueue (client gone but abort hasn't propagated yet). Must be idempotent —
  // an orphaned subscriber would otherwise poll Docker forever after a tab closes.
  const teardown = () => {
    if (closed) return;
    closed = true;
    unsubscribe?.();
    unsubscribe = null;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (request.signal.aborted) {
        teardown();
        return;
      }

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed underneath us — treat as teardown, not a crash.
          teardown();
        }
      };

      // Warm start: replay the ring so a newly-opened tab gets 60s of sparkline
      // history instantly instead of waiting a minute for it to fill back up.
      safeEnqueue(`event: history\ndata: ${JSON.stringify(getTelemetryHistory())}\n\n`);

      unsubscribe = subscribeTelemetry((sample: TelemetrySample) => {
        safeEnqueue(`event: sample\ndata: ${JSON.stringify(sample)}\n\n`);
      });

      heartbeatTimer = setInterval(() => {
        safeEnqueue(": ping\n\n");
      }, HEARTBEAT_MS);

      request.signal.addEventListener("abort", teardown, { once: true });
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

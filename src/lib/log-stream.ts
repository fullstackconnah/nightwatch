import { docker, listContainers } from "@/lib/docker";
import { classifyLevel } from "@/lib/log-levels";
import type { LogLine, LogStream, LogTrackState } from "@/lib/log-types";

/**
 * Server-only streaming log pipeline: frame demuxing, one-shot scrollback reads,
 * and a ref-counted `docker logs --follow` registry shared across every SSE
 * subscriber for a given container.
 *
 * Volume on this host is tiny (~17 lines/minute across all 26 containers), so
 * nothing here batches, backpressures, or rate-limits — it just has to be
 * correct about frame boundaries, which arrive at arbitrary chunk splits.
 */

type OnLine = (line: LogLine) => void;

export interface LogDemuxer {
  push(chunk: Buffer): void;
  flush(): void;
}

/**
 * Streaming counterpart to docker.ts's private one-shot `demuxLogs()`. Exported
 * specifically so it can be unit-tested directly.
 *
 * Docker multiplexes non-TTY container output as: 1 byte stream type (0=stdin,
 * 1=stdout, 2=stderr), 3 zero bytes, 4-byte big-endian payload length, then the
 * payload. Frames may split across arbitrary `push()` boundaries — mid-header,
 * mid-payload, or between frames — so this accumulates a Buffer and only
 * consumes complete frames. A single frame split across three separate push()
 * calls produces byte-identical output to one whole push().
 */
export function createLogDemuxer(
  container: string,
  onLine: OnLine,
  /**
   * Which read this demuxer serves: `"s"` for the one-shot scrollback, `"l"` for
   * the follow stream. It namespaces the ids, and that is load-bearing.
   *
   * Every container gets TWO demuxers per session and each closes over its own
   * `seq` starting at 0, so without this the first live line's id was byte-equal
   * to the first seeded line's. The console records seeded ids so scrollback does
   * not animate — which meant the first 200 live lines per container were treated
   * as already seen and never animated or announced, on top of React reconciling
   * duplicate keys. At this host's ~17 lines/min no sitting ever reached live
   * line 200, so the arrival moment was dead in practice.
   */
  source: "s" | "l",
): LogDemuxer {
  // Annotated: Buffer.alloc infers the narrower Buffer<ArrayBuffer>, while
  // Buffer.concat below returns Buffer<ArrayBufferLike>, and the two do not
  // assign to each other under @types/node 22.
  let buf: Buffer = Buffer.alloc(0);
  let seq = 0;
  // null = not yet determined, true = raw-text mode, false = framed mode. Determined
  // once from the very first byte seen and never revisited.
  let rawMode: boolean | null = null;
  // Per-stream partial-line accumulators: a frame's payload may end mid-line, with
  // the remainder arriving in a later frame.
  const partial: Record<LogStream, string> = { stdout: "", stderr: "" };

  function emitLine(stream: LogStream, raw: string) {
    if (raw.length === 0) return; // bare "\n" — not a real line

    // Docker's timestamp prefix is everything up to the first space (RFC3339Nano).
    // On an unparseable prefix (or no space at all), keep the WHOLE line as text
    // and fall back to Date.now() rather than guess.
    const spaceIdx = raw.indexOf(" ");
    let ts: number | null = null;
    let text = raw;
    if (spaceIdx > 0) {
      const parsed = Date.parse(raw.slice(0, spaceIdx));
      if (!Number.isNaN(parsed)) {
        ts = parsed;
        text = raw.slice(spaceIdx + 1);
      }
    }
    if (ts === null) ts = Date.now();

    onLine({
      id: `${container}:${source}${seq++}`,
      container,
      ts,
      stream,
      level: classifyLevel(text),
      text,
    });
  }

  function feedText(stream: LogStream, chunkText: string) {
    const combined = partial[stream] + chunkText;
    const parts = combined.split("\n");
    partial[stream] = parts.pop() ?? "";
    for (const part of parts) {
      emitLine(stream, part.endsWith("\r") ? part.slice(0, -1) : part);
    }
  }

  function push(chunk: Buffer) {
    if (chunk.length > 0) {
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    }
    if (buf.length === 0) return;

    if (rawMode === null) {
      // Defer the decision until four bytes are in hand: a first chunk of one or
      // two bytes carries no evidence either way, and guessing from it would read
      // framed output as raw text for the life of the stream.
      if (buf.length < 4) return;
      // Validate the whole header shape, not just the type byte — a docker frame
      // header is one type byte followed by three zeros, which is what the
      // one-shot demuxer in docker.ts checks too.
      const type = buf[0];
      const framed =
        (type === 0 || type === 1 || type === 2) &&
        buf[1] === 0 &&
        buf[2] === 0 &&
        buf[3] === 0;
      rawMode = !framed;
    }

    if (rawMode) {
      // No container on this host is TTY — this path exists for a TTY container on
      // some other host, so the code isn't silently wrong there.
      feedText("stdout", buf.toString("utf8"));
      buf = Buffer.alloc(0);
      return;
    }

    while (buf.length >= 8) {
      const type = buf[0];
      const len = buf.readUInt32BE(4);
      if (buf.length < 8 + len) break; // incomplete frame — wait for more data
      const payload = buf.subarray(8, 8 + len);
      feedText(type === 2 ? "stderr" : "stdout", payload.toString("utf8"));
      buf = buf.subarray(8 + len);
    }
  }

  function flush() {
    for (const stream of ["stdout", "stderr"] as const) {
      if (partial[stream].length === 0) continue;
      const trailing = partial[stream];
      partial[stream] = "";
      emitLine(stream, trailing.endsWith("\r") ? trailing.slice(0, -1) : trailing);
    }
  }

  return { push, flush };
}

async function resolveContainerId(name: string): Promise<string> {
  const containers = await listContainers();
  const match = containers.find((c) => c.name === name);
  if (!match) throw new Error("unknown container");
  return match.id;
}

/**
 * One-shot scrollback read. dockerode returns a single Buffer for a non-follow
 * call; that Buffer is run through a fresh demuxer and the resulting lines are
 * sorted by ts since stdout/stderr frames are interleaved but not guaranteed
 * ordered relative to each other.
 */
export async function readContainerLogTail(
  name: string,
  tail: number,
): Promise<{ lines: LogLine[]; short: boolean }> {
  const id = await resolveContainerId(name);
  const container = docker.getContainer(id);
  const buf = (await container.logs({
    stdout: true,
    stderr: true,
    timestamps: true,
    follow: false,
    tail,
  })) as unknown as Buffer;

  const lines: LogLine[] = [];
  const demuxer = createLogDemuxer(name, (line) => lines.push(line), "s");
  demuxer.push(buf);
  demuxer.flush();
  lines.sort((a, b) => a.ts - b.ts);

  return { lines, short: lines.length < tail };
}

/** Minimal shape used off a dockerode follow-stream — Node's ReadableStream type omits destroy(). */
interface DockerLogStream {
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "end" | "close", listener: () => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  destroy?: (error?: Error) => void;
}

interface Feed {
  subscribers: Set<{ onLine: OnLine; onState: (state: LogTrackState) => void }>;
  stream: DockerLogStream | null;
  live: boolean;
  destroyed: boolean;
}

// Cached on globalThis exactly like docker.ts's globalForDocker / telemetry.ts's
// globalForTelemetry, so Next dev HMR reloads of this module reuse running feeds
// instead of leaking a second `docker logs --follow` per container.
const globalForLogs = globalThis as unknown as {
  __logFeeds?: Map<string, Feed>;
};

function feeds(): Map<string, Feed> {
  if (!globalForLogs.__logFeeds) globalForLogs.__logFeeds = new Map();
  return globalForLogs.__logFeeds;
}

function ended(name: string, feed: Feed, registry: Map<string, Feed>, demuxer: LogDemuxer) {
  if (feed.destroyed) return;
  demuxer.flush();
  feed.destroyed = true;
  for (const sub of feed.subscribers) {
    sub.onState({
      container: name,
      status: "ended",
      detail: "stream closed — the container is no longer running",
    });
  }
  if (registry.get(name) === feed) registry.delete(name);
}

/**
 * Ref-counted shared feed: the first subscriber for a container name creates the
 * `docker logs --follow` stream; every later subscriber for the same name rides
 * the same demuxed line fan-out. The last unsubscribe tears the docker stream down.
 *
 * `tail: 0` is deliberate — scrollback comes from `readContainerLogTail`, and
 * requesting it again here would duplicate lines already delivered as a seed.
 */
export function subscribeContainerLogs(
  name: string,
  onLine: OnLine,
  onState: (state: LogTrackState) => void,
): () => void {
  const registry = feeds();
  const subscriber = { onLine, onState };

  const unsubscribe = (): void => {
    const feed = registry.get(name);
    if (!feed || !feed.subscribers.has(subscriber)) return; // already torn down / no-op
    feed.subscribers.delete(subscriber);
    if (feed.subscribers.size === 0) {
      feed.destroyed = true;
      feed.stream?.destroy?.();
      if (registry.get(name) === feed) registry.delete(name);
    }
  };
  // Idempotent: a second call finds the subscriber already removed and no-ops.
  let unsubscribed = false;
  const idempotentUnsubscribe = () => {
    if (unsubscribed) return;
    unsubscribed = true;
    unsubscribe();
  };

  const existing = registry.get(name);
  if (existing) {
    existing.subscribers.add(subscriber);
    if (existing.live) {
      onState({ container: name, status: "live", detail: null });
    }
    // else: still attaching — the attach below will broadcast live/error to every
    // subscriber present at that time, including this one.
    return idempotentUnsubscribe;
  }

  const feed: Feed = { subscribers: new Set([subscriber]), stream: null, live: false, destroyed: false };
  registry.set(name, feed);

  // Wrapped in try/catch so a failed attach (unknown container, daemon hiccup) is
  // reported through onState and never thrown back at the caller.
  void (async () => {
    try {
      const id = await resolveContainerId(name);
      if (feed.destroyed) return; // every subscriber left before we finished attaching

      const dockerStream = (await docker.getContainer(id).logs({
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: true,
        tail: 0,
      })) as unknown as DockerLogStream;

      if (feed.destroyed) {
        dockerStream.destroy?.();
        return;
      }
      feed.stream = dockerStream;

      const demuxer = createLogDemuxer(
        name,
        (line) => {
          for (const sub of feed.subscribers) sub.onLine(line);
        },
        "l",
      );

      dockerStream.on("data", (chunk) => demuxer.push(chunk));
      dockerStream.on("end", () => ended(name, feed, registry, demuxer));
      dockerStream.on("close", () => ended(name, feed, registry, demuxer));
      dockerStream.on("error", (err) => {
        if (feed.destroyed) return;
        feed.destroyed = true;
        for (const sub of feed.subscribers) {
          sub.onState({ container: name, status: "error", detail: err.message });
        }
        dockerStream.destroy?.();
        if (registry.get(name) === feed) registry.delete(name);
      });

      feed.live = true;
      for (const sub of feed.subscribers) {
        sub.onState({ container: name, status: "live", detail: null });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      feed.destroyed = true;
      for (const sub of feed.subscribers) {
        sub.onState({ container: name, status: "error", detail: message });
      }
      if (registry.get(name) === feed) registry.delete(name);
    }
  })();

  return idempotentUnsubscribe;
}

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { bearerOk, MIN_TOKEN_LENGTH } from "./auth.ts";
import { loadConfig, VERSION } from "./config.ts";
import { buildLibrary, readDisk, titleDetail } from "./library.ts";
import { resolveMediaPath } from "./paths.ts";
import { probeFile, type FileStat } from "./probe.ts";
import { createScanner, scheduleNightly, type Scanner } from "./scan.ts";
import { thresholds } from "./sweet-spot.ts";
import type { Health } from "./types.ts";
import type { VerdictInput } from "./verdict.ts";

const BODY_CAP = 16 * 1024;

export interface ServerOpts {
  token: string;
  mediaRoot: string;
  stateDir: string;
  port?: number;
  host?: string;
  probe?: (abs: string, st: FileStat) => Promise<VerdictInput>;
  /** Start a scan at boot when there is no fresh cache (default true). */
  scanOnBoot?: boolean;
  /** Arm the 04:00 rescan (default true). */
  nightly?: boolean;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  now?: () => Date;
  scanner?: Scanner;
}

export interface RunningServer {
  server: Server;
  port: number;
  scanner: Scanner;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/** The body as text, or null when it is over the cap. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] ?? 0) > BODY_CAP) return resolve(null);
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > BODY_CAP) { chunks.length = 0; req.pause(); resolve(null); } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function startServer(opts: ServerOpts): Promise<RunningServer> {
  if (opts.token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`MEDIA_WORKER_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  const log = opts.log ?? ((line) => console.log(line));
  const env = opts.env ?? process.env;
  const scaled = thresholds(env);
  if (env.MEDIA_WORKER_TEST_THRESHOLDS === "1") {
    log(`WARNING: TEST THRESHOLDS ON (MIN_FILE_BYTES=${scaled.MIN_FILE_BYTES}, MIN_SAVING_BYTES=${scaled.MIN_SAVING_BYTES}); never set this on the live stack`);
  }

  const scanner = opts.scanner ?? createScanner({
    mediaRoot: opts.mediaRoot, stateDir: opts.stateDir, probe: opts.probe ?? probeFile, now: opts.now, env, log,
  });
  const health: Health = {
    ok: true, version: VERSION, compressEnabled: false, compressReady: false, reason: "Read-only worker",
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://worker");
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, health);
      if (!bearerOk(req.headers.authorization, opts.token)) return send(res, 401, { error: "unauthorized" });

      if (req.method === "GET" && url.pathname === "/library") {
        return send(res, 200, buildLibrary(scanner.files(), scanner.state(), scanner.scannedAt(), readDisk(opts.mediaRoot)));
      }
      if (req.method === "GET" && url.pathname === "/title") {
        const id = url.searchParams.get("id");
        const resolved = resolveMediaPath(id, opts.mediaRoot);
        if ("error" in resolved) return send(res, resolved.status, { error: resolved.error });
        const detail = titleDetail(scanner.files(), id as string);
        return detail ? send(res, 200, detail) : send(res, 404, { error: "Unknown title" });
      }
      if (req.method === "POST" && url.pathname === "/scan") {
        const body = await readBody(req);
        if (body === null) {
          res.setHeader("connection", "close");
          res.on("finish", () => req.destroy());
          return send(res, 413, { error: "Request body too large" });
        }
        if (body.trim()) {
          try { JSON.parse(body); } catch { return send(res, 400, { error: "Body must be JSON" }); }
        }
        if (!scanner.start()) return send(res, 409, { error: "A scan is already running" });
        return send(res, 202, scanner.state());
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      log(`request failed: ${(e as Error).message}`);
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    }
  });

  const nightly = opts.nightly === false ? null : scheduleNightly(() => { scanner.start(); }, { now: opts.now });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", () => {
      if (opts.scanOnBoot !== false && scanner.needsBootScan()) scanner.start();
      const addr = server.address();
      resolve({
        server, scanner, port: typeof addr === "object" && addr ? addr.port : 0,
        close: async () => {
          nightly?.stop();
          server.closeAllConnections();
          await new Promise<void>((r) => server.close(() => r()));
          await scanner.whenIdle();
        },
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const c = loadConfig();
  startServer(c).then(
    (r) => console.log(`media-worker ${VERSION} listening on port ${r.port}`),
    (e: Error) => { console.error(e.message); process.exit(1); },
  );
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createKioskElevationToken, createSessionToken, isRequestAuthenticated } from "../auth.ts";
import { kioskMayCall } from "../kiosk-access.ts";
import { cancelBatchResponse, cancelResponse, enqueueResponse, jobsResponse, libraryResponse, safeReason, scanResponse, titleResponse, undoResponse } from "./routes.ts";
import { MediaWorkerClient, mediaWorkerCredentials } from "./worker.ts";

const TOKEN = "t".repeat(40);

class TestClient extends MediaWorkerClient {
  creds: { url: string; token: string } | null;
  constructor(creds: { url: string; token: string } | null) {
    super();
    this.creds = creds;
  }
  protected credentials() {
    return this.creds;
  }
}

let server: Server;
let url = "";
let lastUrl = "";
let mode: "ok" | "401" | "409" | "404" = "ok";
before(async () => {
  server = createServer((req, res) => {
    lastUrl = req.url ?? "";
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (mode === "401" || req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "unauthorized" });
    if (mode === "409") return send(409, { error: "A scan is already running" });
    if (mode === "404") return send(404, { error: "/mnt/media/x is gone on 10.0.0.5" });
    if (req.method === "POST") return send(202, { state: "running" });
    send(200, { titles: [], seen: lastUrl });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const ok = () => new TestClient({ url, token: TOKEN });
const dead = () => new TestClient({ url: "http://127.0.0.1:1", token: TOKEN });
const text = async (r: Response) => JSON.stringify(await r.clone().json());

describe("mediaWorkerCredentials", () => {
  it("trims, strips trailing slashes, and gives null when a value is missing", () => {
    assert.deepEqual(mediaWorkerCredentials({ workerUrl: " http://w.example.invalid:8091// ", workerToken: " tok " }), {
      url: "http://w.example.invalid:8091",
      token: "tok",
    });
    assert.equal(mediaWorkerCredentials({ workerUrl: "http://w.example.invalid" }), null);
    assert.equal(mediaWorkerCredentials({ workerToken: "tok" }), null);
    assert.equal(mediaWorkerCredentials(undefined), null);
  });
});

describe("library route", () => {
  it("is always 200 and reports the worker status", async () => {
    const good = await libraryResponse(ok());
    assert.equal(good.status, 200);
    assert.equal((await good.json()).worker, "ok");
    const none = await libraryResponse(new TestClient(null));
    assert.equal(none.status, 200);
    assert.equal((await none.json()).worker, "unconfigured");
    assert.equal((await libraryResponse(dead())).status, 200);
    assert.equal((await (await libraryResponse(dead())).json()).worker, "unreachable");
  });

  it("a worker 401 is status unauthorized in a 200, never a 401", async () => {
    mode = "401";
    const r = await libraryResponse(ok());
    mode = "ok";
    assert.equal(r.status, 200);
    assert.equal((await r.json()).worker, "unauthorized");
  });

  it("no response carries the token or the worker host", async () => {
    const responses = [
      await libraryResponse(ok()),
      await libraryResponse(dead()),
      await libraryResponse(new TestClient({ url, token: "wrong" })),
      await titleResponse("tv/Bluey", dead()),
      await scanResponse(dead()),
    ];
    mode = "404";
    responses.push(await titleResponse("tv/Bluey", ok()));
    mode = "ok";
    for (const r of responses) {
      const body = await text(r);
      assert.ok(!body.includes(TOKEN), body);
      assert.ok(!body.includes("127.0.0.1"), body);
      assert.ok(!body.includes("/mnt/"), body);
      assert.ok(!body.includes("10.0.0.5"), body);
    }
  });
});

describe("title route", () => {
  it("passes a loose-file movie id with / and spaces URL-encoded (N6)", async () => {
    const id = "movies/Big Film (2001).mkv";
    const r = await titleResponse(id, ok());
    assert.equal(r.status, 200);
    assert.equal(lastUrl, `/title?id=${encodeURIComponent(id)}`);
    assert.match(lastUrl, /%2F/);
    assert.match(lastUrl, /%20/);
  });

  it("a missing id is 400; a worker 404 stays 404 with fixed words", async () => {
    assert.equal((await titleResponse("", ok())).status, 400);
    mode = "404";
    const r = await titleResponse("tv/Gone", ok());
    mode = "ok";
    assert.equal(r.status, 404);
  });

  it("a worker 401 becomes 502, not 401", async () => {
    mode = "401";
    const r = await titleResponse("tv/Bluey", ok());
    mode = "ok";
    assert.equal(r.status, 502);
  });
});

describe("scan route", () => {
  it("202 on start; a running scan is 409; a refused token is 502; down is 502", async () => {
    assert.equal((await scanResponse(ok())).status, 202);
    mode = "409";
    assert.equal((await scanResponse(ok())).status, 409);
    mode = "401";
    const bad = await scanResponse(ok());
    assert.equal(bad.status, 502);
    assert.equal((await bad.json()).worker, "unauthorized");
    mode = "ok";
    const down = await scanResponse(dead());
    assert.equal(down.status, 502);
    assert.equal((await down.json()).worker, "unreachable");
    assert.equal((await scanResponse(new TestClient(null))).status, 409);
  });
});

describe("session rule (N5)", () => {
  it("answers no without a dashboard session; a kiosk elevation cannot call media", async () => {
    for (const [m, p] of [["GET", "/api/media/library"], ["GET", "/api/media/title"], ["POST", "/api/media/scan"]] as const) {
      assert.equal(await isRequestAuthenticated(undefined, undefined, m, p), false, p);
      assert.equal(kioskMayCall(m, p), false, p);
      assert.equal(await isRequestAuthenticated(undefined, await createKioskElevationToken(), m, p), false, p);
      assert.equal(await isRequestAuthenticated(await createSessionToken(), undefined, m, p), true, p);
    }
  });

  it("middleware keeps /api/media out of PUBLIC_PATHS and inside the matcher", () => {
    const src = readFileSync(new URL("../../middleware.ts", import.meta.url), "utf8");
    const paths = /const PUBLIC_PATHS = \[([^\]]*)\]/.exec(src)?.[1] ?? "";
    assert.ok(paths.length > 0 && !paths.includes("media"));
    const matcher = /matcher:\s*\[\s*"([^"]+)"\s*\]/.exec(src)?.[1] ?? "";
    assert.equal(new RegExp(`^${matcher}$`).test("/api/media/library"), true);
  });
});

describe("shared types (M1)", () => {
  it("src imports only the worker's types file, and only as a type", () => {
    const file = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");
    const pm = readFileSync(new URL("./page-model.ts", import.meta.url), "utf8");
    for (const src of [file, pm]) {
      for (const line of src.split("\n").filter((l) => /services\//.test(l) && /from/.test(l))) {
        assert.match(line, /^import type .* from "(\.\.\/)+services\/media-worker\/src\/types\.ts";$/);
      }
    }
  });
});

describe("jobs routes (B9)", () => {
  const JOB = "abcdef12-3456";
  it("GET passes the worker data through; down gives worker:unreachable", async () => {
    const r = await jobsResponse(ok());
    assert.equal(r.status, 200);
    assert.equal((await r.json()).worker, "ok");
    assert.equal((await (await jobsResponse(dead())).json()).worker, "unreachable");
  });

  it("enqueue sends one path or a batch; a bad body is a 400 with no fetch", async () => {
    lastUrl = "";
    assert.equal((await enqueueResponse(null, ok())).status, 400);
    assert.equal((await enqueueResponse({ paths: [] }, ok())).status, 400);
    assert.equal((await enqueueResponse({ paths: Array.from({ length: 201 }, (_, i) => `movies/${i}.mkv`) }, ok())).status, 400);
    assert.equal((await enqueueResponse({ paths: ["movies/a.mkv", 3] }, ok())).status, 400);
    assert.equal(lastUrl, "");
    assert.equal((await enqueueResponse({ path: "movies/a.mkv" }, ok())).status, 201);
    assert.equal(lastUrl, "/jobs");
    assert.equal((await enqueueResponse({ paths: ["movies/a.mkv", "tv/b.mkv"] }, ok())).status, 201);
  });

  it("a worker 409 keeps its plain sentence; a reason with a path or address is replaced by fixed words", async () => {
    mode = "409";
    const safe = await enqueueResponse({ path: "movies/a.mkv" }, ok());
    assert.equal(safe.status, 409);
    assert.equal((await safe.json()).error, "A scan is already running");
    mode = "404";
    const leaky = await enqueueResponse({ path: "movies/a.mkv" }, ok());
    mode = "ok";
    assert.equal(leaky.status, 404);
    assert.doesNotMatch(await text(leaky), /mnt|10\.0\.0/);
  });

  it("safeReason keeps an apostrophe, refuses a slash, a colon, a backslash and an address", () => {
    const wrap = (e: string) => `Media worker returned HTTP 409: ${JSON.stringify({ error: e })}`;
    assert.equal(safeReason(wrap("Not compressible. It's already small.")), "Not compressible. It's already small.");
    for (const bad of ["see /mnt/x", "disk: full", `a${String.fromCharCode(92)}b`,"host 10.1.2.3 down", "<b>", ""]) assert.equal(safeReason(wrap(bad)), null, bad);
    const disk = "Needs 10.5 GB free to compress this file; 3.2 GB is free. Space from compressed files comes back when their originals are deleted on 12 Nov.";
    assert.equal(safeReason(wrap(disk)), disk);
    assert.equal(safeReason("Media worker returned HTTP 409."), null);
    assert.equal(safeReason(wrap("x".repeat(201))), null);
  });

  it("cancel, batch cancel and undo validate the id before any fetch, then forward it", async () => {
    lastUrl = "";
    for (const f of [cancelResponse, cancelBatchResponse, undoResponse]) {
      for (const bad of [null, "", "short", "../library", "a/b/c/d/e/f/g/h", "UPPERCASE-ID"]) assert.equal((await f(bad, ok())).status, 400, String(bad));
    }
    assert.equal(lastUrl, "");
    assert.equal((await cancelResponse(JOB, ok())).status, 200);
    assert.equal(lastUrl, `/jobs/${JOB}/cancel`);
    assert.equal((await undoResponse(JOB, ok())).status, 200);
    assert.equal(lastUrl, `/jobs/${JOB}/undo`);
    assert.equal((await cancelBatchResponse(JOB, ok())).status, 200);
    assert.equal(lastUrl, `/jobs/batch/${JOB}/cancel`);
  });

  it("a worker 401 is a 502; the kiosk may call none of them", async () => {
    mode = "401";
    const r = await undoResponse(JOB, ok());
    mode = "ok";
    assert.equal(r.status, 502);
    for (const [m, p] of [["GET", "/api/media/jobs"], ["POST", "/api/media/jobs"], ["POST", `/api/media/jobs/${JOB}/cancel`], ["POST", `/api/media/jobs/${JOB}/undo`], ["POST", `/api/media/jobs/batch/${JOB}/cancel`]] as const) {
      assert.equal(kioskMayCall(m, p), false, p);
      assert.equal(await isRequestAuthenticated(undefined, await createKioskElevationToken(), m, p), false, p);
    }
  });
});

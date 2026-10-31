import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createKioskElevationToken,
  createOidcFlowToken,
  verifyOidcFlowToken,
  createSessionToken,
  isRequestAuthenticated,
  verifyKioskElevationToken,
  verifySessionToken,
} from "./auth.ts";
import { SignJWT } from "jose";
import { secretKey } from "./auth.ts";
import { jobVisible, kioskMayCall, runAllowed } from "./kiosk-access.ts";
import { isContainerId } from "./container-id.ts";

describe("isContainerId", () => {
  it("accepts real ids and names, refuses path-ish input", () => {
    assert.ok(isContainerId("abc123def456"));
    assert.ok(isContainerId("my-app_1.web"));
    assert.ok(!isContainerId("..%2F..%2Fexec"));
    assert.ok(!isContainerId("a/b"));
    assert.ok(!isContainerId(""));
    assert.ok(!isContainerId("-leading"));
    assert.ok(!isContainerId("a".repeat(129)));
  });
});

// Every /api/ URL the elevated kiosk code uses must be public (middleware) or
// on the allowlist with the method it uses. Methods are declared per URL here.
describe("kiosk callers vs allowlist", () => {
  const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) files.push(p);
    }
  };
  walk(join(root, "components/kiosk"));
  files.push(join(root, "lib/use-voice.ts"), join(root, "lib/use-hermes.ts"));

  // URL -> [method, concrete path]; /kiosk/api/* is public and not listed.
  const METHODS: Record<string, [string, string]> = {
    "/api/voice/status": ["GET", "/api/voice/status"],
    "/api/voice/transcribe": ["POST", "/api/voice/transcribe"],
    "/api/voice/speak": ["POST", "/api/voice/speak"],
    "/api/hermes-ctl/status": ["GET", "/api/hermes-ctl/status"],
    "/api/hermes-ctl/run": ["POST", "/api/hermes-ctl/run"],
    "/api/hermes-ctl/jobs/": ["GET", "/api/hermes-ctl/jobs/abc"],
  };

  it("lists every non-public /api/ URL used and each is allowed", () => {
    const found = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/["'`](\/api\/[a-z][a-z0-9/-]*\/?)/g)) found.add(m[1]);
    }
    // Docs-only mentions of the docker routes in kiosk-admin-panel are comments.
    for (const url of found) {
      if (url.startsWith("/api/docker/") || url === "/api/hermes-ctl/activity") continue;
      const entry = METHODS[url];
      assert.ok(entry, `unclassified kiosk URL ${url}`);
      assert.ok(kioskMayCall(entry[0], entry[1]), `${entry[0]} ${entry[1]} not allowed`);
    }
    assert.ok(found.has("/api/hermes-ctl/run"));
  });
});

describe("kioskMayCall (what an elevated kiosk may reach)", () => {
  it("allows the container list, lifecycle action and voice calls the kiosk makes", () => {
    assert.ok(kioskMayCall("GET", "/api/docker/containers"));
    assert.ok(kioskMayCall("POST", "/api/docker/containers/abc123def456/action"));
    assert.ok(kioskMayCall("GET", "/api/voice/status"));
    assert.ok(kioskMayCall("POST", "/api/voice/transcribe"));
    assert.ok(kioskMayCall("POST", "/api/voice/speak"));
  });

  it("refuses everything else, including wrong methods on allowed paths", () => {
    assert.ok(!kioskMayCall("GET", "/api/settings/system"));
    assert.ok(!kioskMayCall("PUT", "/api/settings/system"));
    assert.ok(!kioskMayCall("POST", "/api/docker/prune"));
    assert.ok(!kioskMayCall("POST", "/api/docker/containers")); // create
    assert.ok(!kioskMayCall("DELETE", "/api/docker/containers/abc"));
    assert.ok(!kioskMayCall("GET", "/api/docker/containers/abc/logs"));
    assert.ok(!kioskMayCall("GET", "/api/docker/containers/abc/action"));
    assert.ok(!kioskMayCall("POST", "/api/docker/containers/a/b/action"));
    assert.ok(!kioskMayCall("DELETE", "/api/docker/images/abc"));
    assert.ok(!kioskMayCall("GET", "/settings"));
    assert.ok(!kioskMayCall("GET", "/"));
  });
});

describe("isRequestAuthenticated", () => {
  it("a session cookie passes every route", async () => {
    const session = await createSessionToken();
    for (const [m, p] of [["GET", "/api/settings/system"], ["POST", "/api/docker/prune"], ["GET", "/settings"]]) {
      assert.ok(await isRequestAuthenticated(session, undefined, m, p));
    }
  });

  it("an elevation cookie passes only the kiosk allowlist", async () => {
    const kiosk = await createKioskElevationToken();
    assert.ok(await isRequestAuthenticated(undefined, kiosk, "POST", "/api/docker/containers/abc/action"));
    assert.ok(!(await isRequestAuthenticated(undefined, kiosk, "GET", "/api/settings/system")));
    assert.ok(!(await isRequestAuthenticated(undefined, kiosk, "POST", "/api/docker/prune")));
    assert.ok(!(await isRequestAuthenticated(undefined, kiosk, "GET", "/settings")));
  });

  it("an elevation token in the session slot is refused (token confusion)", async () => {
    const kiosk = await createKioskElevationToken();
    assert.ok(!(await isRequestAuthenticated(kiosk, undefined, "GET", "/api/settings/system")));
    assert.ok(!(await verifySessionToken(kiosk)));
  });

  it("an OIDC flow token in the session slot is refused", async () => {
    const flow = await createOidcFlowToken({ state: "s", nonce: "n", verifier: "v" });
    assert.ok(!(await isRequestAuthenticated(flow, undefined, "GET", "/api/settings/system")));
  });

  it("a session token in the elevation slot does not count as elevation", async () => {
    const session = await createSessionToken();
    assert.ok(!(await verifyKioskElevationToken(session)));
    assert.ok(!(await isRequestAuthenticated(undefined, session, "POST", "/api/docker/containers/abc/action")));
  });

  it("an OIDC flow token is not a kiosk elevation, and a session is not a flow token", async () => {
    const flow = await createOidcFlowToken({ state: "s", nonce: "n", verifier: "v" });
    assert.ok(!(await verifyKioskElevationToken(flow)));
    assert.equal(await verifyOidcFlowToken(await createSessionToken()), null);
    assert.equal(await verifyOidcFlowToken(await createKioskElevationToken()), null);
    assert.ok(await verifyOidcFlowToken(flow));
  });

  // Right secret, every other claim valid: only the `typ` check can refuse these.
  const sign = (claims: Record<string, unknown>) =>
    new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("60s").sign(secretKey());

  it("each verifier refuses a wrong or missing typ on its own", async () => {
    assert.ok(!(await verifySessionToken(await sign({ sub: "admin", typ: "kiosk" }))));
    assert.ok(!(await verifySessionToken(await sign({ sub: "admin" }))));
    assert.ok(!(await verifyKioskElevationToken(await sign({ sub: "kiosk", kiosk: true, typ: "session" }))));
    assert.ok(!(await verifyKioskElevationToken(await sign({ sub: "kiosk", kiosk: true }))));
    const flow = { state: "s", nonce: "n", verifier: "v" };
    assert.equal(await verifyOidcFlowToken(await sign({ ...flow, typ: "session" })), null);
    assert.equal(await verifyOidcFlowToken(await sign(flow)), null);
  });

  it("an elevation-only caller may start or read only ask jobs", () => {
    for (const fn of [runAllowed, jobVisible]) {
      assert.equal(fn("ask", false), true);
      assert.equal(fn("digest", false), false);
      assert.equal(fn("alert-test", false), false);
      assert.equal(fn("bogus", false), false);
      for (const kind of ["ask", "digest", "alert-test"]) assert.equal(fn(kind, true), true);
    }
  });

  it("no cookie passes nothing", async () => {
    assert.ok(!(await isRequestAuthenticated(undefined, undefined, "GET", "/api/docker/containers")));
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPublicPath } from "./public-paths.ts";

describe("isPublicPath (PR B, segment match)", () => {
  const publicOnes = [
    "/login", "/api/auth/login", "/api/auth/kiosk", "/api/auth/kiosk/refresh", "/api/auth/kiosk/lock",
    "/api/auth/oidc/login", "/api/auth/oidc/callback", "/kiosk", "/kiosk/api/vitals", "/kiosk/api/list/add",
    "/api/mcp", "/api/mcp/sse", "/dashboard.webmanifest", "/kiosk.webmanifest",
    "/kiosk-icon-180.png", "/kiosk-icon-192.png", "/kiosk-icon-512.png",
  ];
  const protectedOnes = [
    "/api/mcpfoo", "/loginx", "/login-admin", "/api/authx", "/api/auth/loginx", "/api/auth/kioskx", "/api/auth/oidcx",
    "/kioskx", "/kiosk-icon-999.png", "/kiosk.webmanifest.bak", "/dashboard.webmanifestx", "/api/auth/logout",
    "/", "/api/settings", "/settings",
  ];
  for (const p of publicOnes) it(`public: ${p}`, () => assert.equal(isPublicPath(p), true));
  for (const p of protectedOnes) it(`not public: ${p}`, () => assert.equal(isPublicPath(p), false));
});

import { verifySessionToken } from "./auth.ts";

// Real admin session only. The kiosk elevation cookie is deliberately ignored: these routes control the owner's PC.
// verifySessionToken requires typ "session", so kiosk and oidc-flow tokens (same secret) are refused.
export const fullSessionAllowed = verifySessionToken;

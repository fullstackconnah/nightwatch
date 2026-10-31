import { verifySessionToken } from "./auth.ts";

// Full admin session only: verifySessionToken requires typ "session", so kiosk and oidc-flow tokens (same secret) are refused.
export const uploadAuthorized = verifySessionToken;

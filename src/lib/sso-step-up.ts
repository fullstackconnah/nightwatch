/* Alias-free so node:test can load it: when the SSO card's pending edit is a protected change that asks for the current password. */

/** Mirrors the route: the secret is trimmed first, so spaces alone are not a change (stepUpNeeded sees an empty secret). */
export function ssoStepUpPending(
  draft: { issuer: string; clientId: string; clientSecret: string },
  stored: { oidcIssuer?: string; oidcClientId?: string },
): boolean {
  return draft.issuer !== (stored.oidcIssuer ?? "") || draft.clientId !== (stored.oidcClientId ?? "") || draft.clientSecret.trim() !== "";
}

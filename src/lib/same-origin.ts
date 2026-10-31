// Refuses browser-driven cross-site writes. The session cookie is SameSite=Lax,
// and every app on this host's IP is the same site (ports don't count), so
// another app's page could otherwise send credentialed POSTs here.
export function crossSiteWriteRefused(method: string, headers: Headers): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return false;

  const site = headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";

  const origin = headers.get("origin");
  if (origin) {
    try {
      const host = headers.get("x-forwarded-host")?.split(",")[0].trim() || headers.get("host");
      return new URL(origin).host !== host;
    } catch {
      return true; // "null" and garbage both land here
    }
  }

  return false; // why: a browser always sends one of the two on a cross-origin write, so neither means a non-browser client
}

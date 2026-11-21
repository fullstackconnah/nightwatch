/* Browser-facing origin for the OIDC routes (relative-import-only so node:test can load it).
 * req.nextUrl.origin reflects the server's BIND address (0.0.0.0:3005 inside the container), not what the user typed,
 * which broke the OIDC redirect_uri exact-match check (observed live 2026-08-02). The Host header carries the address
 * the browser actually used; protocol honors x-forwarded-proto when a proxy fronts us. */
export interface OriginRequest {
  headers: { get(name: string): string | null };
  nextUrl: { host: string };
}

export function requestOrigin(req: OriginRequest): string {
  const host = req.headers.get("host") ?? req.nextUrl.host;
  // Behind two proxies the header is "https,http": first value only, anything but http(s) falls back to http.
  const first = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  return `${first === "https" ? "https" : "http"}://${host}`;
}

/** URL code for a failed token exchange: a provider outage (or discovery failure) reads as "SSO is not available", not "rejected". Duck-typed so this file stays import-free. */
export function exchangeErrorCode(err: unknown): "config" | "exchange_failed" {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return code === "config" || code === "discovery_failed" || code === "provider_unreachable" ? "config" : "exchange_failed";
}

/** /login?sso_error=<code> on the browser's origin. The raw error never reaches the URL, only a code. */
export function ssoErrorUrl(req: OriginRequest, code: string): URL {
  const login = new URL("/login", requestOrigin(req));
  login.searchParams.set("sso_error", code);
  return login;
}

/** True when the browser reached us over https: the proxy's first x-forwarded-proto value, else the URL's own protocol. */
export function isSecureRequest(req: { headers: { get(name: string): string | null }; nextUrl: { protocol: string } }): boolean {
  const fwd = req.headers.get("x-forwarded-proto");
  if (fwd === null) return req.nextUrl.protocol === "https:";
  return fwd.split(",")[0].trim().toLowerCase() === "https";
}

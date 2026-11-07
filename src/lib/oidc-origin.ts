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
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/** /login?sso_error=<code> on the browser's origin. The raw error never reaches the URL, only a code. */
export function ssoErrorUrl(req: OriginRequest, code: string): URL {
  const login = new URL("/login", requestOrigin(req));
  login.searchParams.set("sso_error", code);
  return login;
}

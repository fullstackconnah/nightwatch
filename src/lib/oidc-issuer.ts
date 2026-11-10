/** Discovery-document issuer check: trailing slashes are ignored on both sides
 *  (providers like Authentik publish `.../app/`); scheme, host, path and case
 *  must still match exactly. */
import { httpUrlError } from "./settings-checks.ts";

/** The env/config issuer gate: a plain http(s) URL (no login, query or fragment), trailing slashes dropped. */
export function checkedIssuer(raw: string): { issuer: string } | { error: string } {
  const error = httpUrlError("oidcIssuer", raw);
  return error ? { error } : { issuer: raw.replace(/\/+$/, "") };
}

export function sameIssuer(docIssuer: string, savedIssuer: string): boolean {
  const strip = (s: string) => s.replace(/\/+$/, "");
  return strip(docIssuer) === strip(savedIssuer);
}

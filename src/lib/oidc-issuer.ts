/** Discovery-document issuer check: trailing slashes are ignored on both sides
 *  (providers like Authentik publish `.../app/`); scheme, host, path and case
 *  must still match exactly. */
export function sameIssuer(docIssuer: string, savedIssuer: string): boolean {
  const strip = (s: string) => s.replace(/\/+$/, "");
  return strip(docIssuer) === strip(savedIssuer);
}

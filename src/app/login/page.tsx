import { oidcConfig } from "@/lib/oidc";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/** The four codes /api/auth/oidc/callback can redirect back with — anything
 *  else in the query string is ignored rather than echoed to the page. */
const SSO_ERROR_CODES = new Set(["denied", "exchange_failed", "verify_failed", "config"]);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sso_error?: string }>;
}) {
  const { sso_error } = await searchParams;

  // Server-only check: oidcConfig() reads three env vars and returns null
  // unless all three are set. Only a boolean crosses into the client
  // component below — never the issuer, client id, or secret.
  const ssoConfigured = oidcConfig() !== null;
  const ssoError = sso_error && SSO_ERROR_CODES.has(sso_error) ? sso_error : null;

  return <LoginForm ssoConfigured={ssoConfigured} ssoError={ssoError} />;
}

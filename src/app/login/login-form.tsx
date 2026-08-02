"use client";

import { useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

/** One line per code the callback route can redirect back with — see
 *  src/app/api/auth/oidc/callback/route.ts. Codes only, never a raw error
 *  string, so nothing internal ever surfaces in the URL or on screen. */
const SSO_ERROR_COPY: Record<string, string> = {
  denied: "Sign-in was cancelled or could not be confirmed with Authelia.",
  exchange_failed: "Authelia rejected the sign-in exchange — try again.",
  verify_failed: "The sign-in response could not be verified — try again.",
  config: "SSO is not available right now.",
};

export function LoginForm({
  ssoConfigured,
  ssoError,
}: {
  ssoConfigured: boolean;
  ssoError: string | null;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-xs panel p-6 space-y-4">
        <div className="flex items-center gap-2 justify-center pb-2">
          <Activity size={18} className="text-accent" />
          <span className="font-mono text-lg font-semibold tracking-wide">
            night<span className="text-accent">watch</span>
          </span>
        </div>

        {ssoError && SSO_ERROR_COPY[ssoError] && <p className="text-bad text-xs text-center">{SSO_ERROR_COPY[ssoError]}</p>}

        {ssoConfigured && (
          <>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => {
                window.location.href = "/api/auth/oidc/login";
              }}
            >
              <ShieldCheck size={15} />
              Sign in with SSO
            </Button>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-line" />
              <span className="microlabel">or</span>
              <div className="flex-1 h-px bg-line" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="password">Admin password</Label>
            <Input
              id="password"
              type="password"
              autoFocus={!ssoConfigured}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-bad text-xs">{error}</p>}
          <Button type="submit" disabled={busy || !password} className="w-full">
            {busy ? "Checking…" : "Unlock"}
          </Button>
        </form>
      </div>
    </div>
  );
}

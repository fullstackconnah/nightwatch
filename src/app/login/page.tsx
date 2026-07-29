"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export default function LoginPage() {
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
      <form onSubmit={submit} className="panel w-full max-w-xs p-6 space-y-4">
        <div className="flex items-center gap-2 justify-center pb-2">
          <Activity size={18} className="text-accent" />
          <span className="font-mono text-lg font-semibold tracking-wide">
            night<span className="text-accent">watch</span>
          </span>
        </div>
        <div>
          <Label htmlFor="password">Admin password</Label>
          <Input
            id="password"
            type="password"
            autoFocus
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
  );
}

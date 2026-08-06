"use client";

import Link from "next/link";
import { LayoutGrid, LockKeyhole, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useContainers } from "@/lib/client";
import type { TiledContainer } from "@/lib/client";
import {
  ContainerStatus,
  LifecycleActions,
  LifecycleError,
  useLifecycle,
} from "@/components/container-controls";
import { stateDotClass } from "@/components/container-tile";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { BUILD_ID } from "@/lib/build-id";

type CheckState = { kind: "idle" } | { kind: "checking" } | { kind: "result"; label: string };

/**
 * src/app/kiosk/error.tsx already does a `window.location.reload()` to
 * recover from a stale-chunk crash after a deploy, as a side effect of its
 * auto-recovery ladder. This button is the deliberate, on-demand version of
 * that same recovery: compare this page's own inlined BUILD_ID (baked in at
 * build time) against the server's current one, and reload only when they
 * actually differ.
 */
function useUpdateCheck() {
  const [state, setState] = useState<CheckState>({ kind: "idle" });

  const check = async () => {
    if (state.kind === "checking") return; // guard double-taps
    setState({ kind: "checking" });
    try {
      const res = await fetch("/kiosk/api/version");
      const data = (await res.json()) as { buildId: string };
      if (data.buildId !== BUILD_ID) {
        window.location.reload();
        return; // page is navigating away — no idle state to revert to
      }
      // On the test stack and in dev both sides read "dev" (export-subst
      // only substitutes on a real `git archive`), so this always reports
      // up-to-date there — expected, not a bug.
      setState({ kind: "result", label: `Up to date · ${data.buildId}` });
      setTimeout(() => setState({ kind: "idle" }), 4000);
    } catch {
      setState({ kind: "result", label: "Check failed" });
      setTimeout(() => setState({ kind: "idle" }), 4000);
    }
  };

  return { state, check };
}

function AdminRow({ c, onChanged }: { c: TiledContainer; onChanged: () => void }) {
  const lifecycle = useLifecycle(c.id, onChanged);
  return (
    <div className="px-3 py-2.5 border-b border-line/60 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className={cn("dot", stateDotClass(c))} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm truncate" title={c.name}>{c.name}</div>
          <ContainerStatus c={c} className="text-2xs" />
        </div>
        {/* touch: the admin panel is the kiosk's own destructive-action
            surface (PIN-elevated start/stop/restart) — it must never
            inherit the shared `icon` size's desktop `md:` shrink, which
            drops to 32px at exactly the 1024/1180 wall-iPad widths. */}
        <LifecycleActions state={c.state} name={c.name} lifecycle={lifecycle} touch />
      </div>
      <LifecycleError lifecycle={lifecycle} className="mt-1.5" />
    </div>
  );
}

/**
 * The admin surface a PIN-elevated kiosk unlocks: the same container list and
 * start/stop/restart controls the logged-in dashboard has, reached through
 * the SAME authenticated /api/docker/containers[...] routes — the kiosk
 * elevation cookie is what middleware.ts now accepts alongside a real
 * session, so nothing here talks to Docker directly.
 */
export function KioskAdminPanel({ expiresAt, onLock }: { expiresAt: number; onLock: () => void }) {
  const { data, error, mutate } = useContainers(5000);
  const now = useNow(true);
  const remainingMs = Math.max(0, expiresAt - now);
  const mm = Math.floor(remainingMs / 60000);
  const ss = Math.floor((remainingMs % 60000) / 1000);
  const update = useUpdateCheck();
  const checking = update.state.kind === "checking";

  return (
    <div className="w-full max-w-xl flex flex-col gap-3">
      <div className="panel px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-accent text-xs font-mono">
          {/* Accent (teal), not `ok` green: this dot reports "elevation is
              live", not a container's running state, and teal is the token
              this system reserves for "the live signal" — ok green stays
              scoped to real container health (see KioskHealth). */}
          <span className="dot dot-live" />
          elevated · locks in {mm}:{ss.toString().padStart(2, "0")}
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            href="/"
            className="h-11 px-3.5 rounded-md text-ink-dim hover:text-ink hover:bg-panel-2 text-xs flex items-center gap-1.5 outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <LayoutGrid size={13} /> Dashboard
          </Link>
          <button
            type="button"
            onClick={update.check}
            disabled={checking}
            className="h-11 px-3.5 rounded-md border border-line text-ink-dim hover:text-ink hover:border-line-bright text-xs flex items-center gap-1.5 outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-60"
          >
            <RefreshCw size={13} className={cn(checking && "animate-spin")} />
            {update.state.kind === "result" ? update.state.label : "Check for updates"}
          </button>
          <button
            type="button"
            onClick={onLock}
            className="h-11 px-3.5 rounded-md border border-line text-ink-dim hover:text-ink hover:border-line-bright text-xs flex items-center gap-1.5 outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <LockKeyhole size={13} /> Lock
          </button>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="max-h-[45vh] overflow-y-auto">
          {error && (
            <div className="px-4 py-3 text-bad text-sm">Docker unreachable: {error.message}</div>
          )}
          {!error && !data && (
            <div className="px-4 py-6 text-center text-ink-faint text-sm">loading containers…</div>
          )}
          {data?.containers.map((c) => (
            <AdminRow key={c.id} c={c} onChanged={() => mutate()} />
          ))}
          {data && data.containers.length === 0 && (
            <div className="px-4 py-6 text-center text-ink-faint text-sm">no containers found</div>
          )}
        </div>
      </div>
    </div>
  );
}

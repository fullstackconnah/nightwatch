"use client";

import Link from "next/link";
import { LayoutGrid, LockKeyhole } from "lucide-react";
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

function AdminRow({ c, onChanged }: { c: TiledContainer; onChanged: () => void }) {
  const lifecycle = useLifecycle(c.id, onChanged);
  return (
    <div className="px-3 py-2.5 border-b border-line/60 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className={cn("dot", stateDotClass(c))} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm truncate">{c.name}</div>
          <ContainerStatus c={c} className="text-[0.7rem]" />
        </div>
        <LifecycleActions state={c.state} name={c.name} lifecycle={lifecycle} />
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

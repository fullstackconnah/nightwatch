"use client";

/* The non-band /orchestrators states (loading, load failed, unconfigured), same
   real-copy idiom as hermes-status.tsx. The band states live in orchestra-band.tsx. */

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { loadErrorCopy } from "@/lib/orchestra-view";

export function OrchestraLoadError({ status }: { status?: number }) {
  return (
    <div className="panel p-4">
      <div className="mb-2 microlabel !text-bad">load failed</div>
      <p className="text-xs text-ink-dim">{loadErrorCopy(status)}</p>
    </div>
  );
}

export function OrchestraUnconfigured() {
  return (
    <div className="panel p-4 space-y-3">
      <div className="text-sm font-medium text-warn">Orchestra is not connected</div>
      <p className="max-w-prose text-xs text-ink-dim">
        Add the service&apos;s address and token in Settings, under Access. They are saved on this server and never sent to
        the browser.
      </p>
      <Link href="/settings#access" className={buttonVariants({ variant: "outline" })}>
        Open settings
      </Link>
    </div>
  );
}

export function SkeletonBar({ delayMs, className }: { delayMs: number; className?: string }) {
  return (
    <div
      className={`h-4 animate-pulse rounded bg-panel-2 motion-reduce:animate-none ${className ?? ""}`}
      style={{ animationDelay: `${delayMs}ms` }}
    />
  );
}

/** One band-shaped panel and two card-shaped panels, so the shape of what is arriving is itself information. */
export function OrchestraSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Reading orchestra status">
      <div className="panel p-4 space-y-3">
        <SkeletonBar delayMs={0} className="w-1/3" />
        <SkeletonBar delayMs={60} className="w-full" />
        <SkeletonBar delayMs={90} className="w-2/3" />
        <SkeletonBar delayMs={120} className="w-1/2" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="panel p-4 space-y-3">
            <SkeletonBar delayMs={0} className="w-1/3" />
            <SkeletonBar delayMs={60} className="w-full" />
            <SkeletonBar delayMs={90} className="w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

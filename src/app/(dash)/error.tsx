"use client";

/* One boundary for all fifteen /dash routes below this segment (there was
   previously none — src/app/kiosk/error.tsx was the only error.tsx in the
   whole src/app/ tree, so a render throw on e.g. /resources or /logs blanked
   the page with no recovery).

   Deliberately NOT the kiosk's auto-reset -> reload -> stop ladder: that
   ladder exists because nobody stands in front of an unattended wall tablet
   to click anything. A dashboard route is opened by someone sitting at a
   desk or holding their phone — the right move here is to say what broke
   and hand them one deliberate Retry, not to auto-retry behind their back.

   Route-segment limitation (same one kiosk/error.tsx documents): this only
   catches renders inside `(dash)`'s own segment tree, not a throw from
   `(dash)/layout.tsx` itself (the sidebar/top bar). That needs the sibling
   src/app/global-error.tsx, which replaces the whole root layout and can't
   share this component's styling since it has to supply its own <html>. */

import Link from "next/link";
import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";

export default function DashError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
      <div className="panel w-full max-w-sm p-6 flex flex-col items-center gap-4 text-center">
        <AlertTriangle size={24} className="text-warn" aria-hidden="true" />

        <div className="flex flex-col gap-1.5">
          <h1 className="text-sm font-semibold text-ink">Something went wrong</h1>
          <p className="text-xs text-ink-dim">
            This page hit an error while rendering. The rest of the dashboard is unaffected — the sidebar
            still works.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full">
          <button
            type="button"
            onClick={reset}
            className="h-11 md:h-9 flex-1 rounded-md border border-accent/30 bg-accent/10 text-accent text-sm font-medium flex items-center justify-center gap-1.5 outline-none hover:bg-accent/20 focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] transition cursor-pointer"
          >
            <RotateCw size={14} aria-hidden="true" />
            Retry
          </button>
          <Link
            href="/"
            className="h-11 md:h-9 flex-1 rounded-md border border-line text-ink-dim text-sm font-medium flex items-center justify-center gap-1.5 outline-none hover:text-ink hover:border-line-bright focus-visible:ring-1 focus-visible:ring-accent transition"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Overview
          </Link>
        </div>

        {error.digest && (
          <p className="text-[0.65rem] font-mono text-ink-faint tabular-nums">ref {error.digest}</p>
        )}
      </div>
    </div>
  );
}

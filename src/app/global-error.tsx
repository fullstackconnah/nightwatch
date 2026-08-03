"use client";

/* Root-layout safety net. src/app/layout.tsx doesn't render anything that
   can throw today (no data fetching, no client state), but the only
   segment boundary that existed anywhere in src/app/ before this fix wave
   was src/app/kiosk/error.tsx — a throw in src/app/layout.tsx itself, or in
   any segment boundary's own render, had nothing above it to catch it and
   blanked the whole page. Next requires global-error.tsx to supply its own
   <html>/<body>: it replaces the root layout wholesale rather than nesting
   inside it, so it can't inherit globals.css from layout.tsx — it imports
   its own copy instead, which is why this file, alone in the tree, needs
   that import.

   Same "someone is sitting in front of this" reasoning as (dash)/error.tsx:
   one deliberate Retry, no auto-reload ladder — that belongs to the kiosk's
   unattended-tablet boundary, not this one. */

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="panel w-full max-w-sm p-6 flex flex-col items-center gap-4 text-center">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-sm font-semibold text-ink">nightwatch hit an error</h1>
              <p className="text-xs text-ink-dim">
                The app shell itself failed to render. Retrying reloads the whole page.
              </p>
            </div>

            <button
              type="button"
              onClick={reset}
              className="h-11 md:h-9 w-full rounded-md border border-accent/30 bg-accent/10 text-accent text-sm font-medium flex items-center justify-center gap-1.5 outline-none hover:bg-accent/20 focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] transition cursor-pointer"
            >
              Retry
            </button>

            {error.digest && (
              <p className="text-[0.65rem] font-mono text-ink-faint tabular-nums">ref {error.digest}</p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}

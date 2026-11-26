/* The one 404 for every route: an unknown URL renders it inside the root layout (bare, no sidebar, so it also works
   signed out); `notFound()` from a (dash) page reaches it through (dash)/not-found.tsx and keeps the dashboard chrome.
   Reads no data on purpose. Look follows (dash)/error.tsx. */
import { SearchX } from "lucide-react";
import { NotFoundHomeLink } from "@/components/not-found-home-link";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
      <div className="panel w-full max-w-sm p-6 flex flex-col items-center gap-4 text-center">
        <SearchX size={24} className="text-ink-dim" aria-hidden="true" />

        <div className="flex flex-col gap-1.5">
          <h1 className="text-sm font-semibold text-ink">This page does not exist</h1>
          <p className="text-xs text-ink-dim">The address may be mistyped, or the page has moved.</p>
        </div>

        <NotFoundHomeLink />
      </div>
    </div>
  );
}

import { SideNav } from "@/components/side-nav";
import { dockgeUrl } from "@/lib/config";

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      {/* Every route sits behind the sidebar's 13-16 focusable links (desktop)
          plus the mobile top/bottom bars — a keyboard user hits all of that
          before reaching page content on every single navigation. sr-only
          until focused, then styled like the rest of the app's focus
          affordances rather than the browser default outline. */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:rounded-md focus-visible:border focus-visible:border-accent/30 focus-visible:bg-panel focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        Skip to content
      </a>
      <SideNav dockgeUrl={dockgeUrl()} />
      <main id="main-content" className="md:pl-52">
        <div className="mx-auto max-w-7xl px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-6">{children}</div>
      </main>
    </div>
  );
}

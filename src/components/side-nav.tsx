"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Boxes,
  HardDrive,
  Database,
  Network,
  ScrollText,
  Settings,
  ExternalLink,
  LogOut,
  Activity,
  Gauge,
  House,
  Globe,
  GitBranch,
  Tv,
  MoreHorizontal,
  X,
  Bot,
  Tablet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useContainers } from "@/lib/client";

type NavItem = { href: string; label: string; icon: typeof LayoutGrid };
type NavGroup = { label: string; items: NavItem[] };

// Three groups, the same taxonomy the sidebar, the mobile "More" sheet and
// (implicitly) the log rail's own stack-grouping idiom all share.
const GROUPS: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { href: "/", label: "Overview", icon: LayoutGrid },
      { href: "/resources", label: "Resources", icon: Gauge },
      { href: "/containers", label: "Containers", icon: Boxes },
      { href: "/logs", label: "Logs", icon: ScrollText },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: "/images", label: "Images", icon: HardDrive },
      { href: "/volumes", label: "Volumes", icon: Database },
      // "Network", not "Networks": the page is no longer a docker-network
      // inventory — it is this box's network (uplink throughput, bridges,
      // container footprint, ports).
      { href: "/networks", label: "Network", icon: Network },
    ],
  },
  {
    label: "Integrations",
    items: [
      { href: "/smarthome", label: "Home", icon: House },
      { href: "/proxy", label: "Proxy", icon: Globe },
      { href: "/git", label: "Git", icon: GitBranch },
      { href: "/hermes", label: "Hermes", icon: Bot },
      { href: "/kiosk", label: "Kiosk", icon: Tablet },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

// The mobile bottom bar's five fixed cells: the Monitor group verbatim, plus
// a "More" cell covering everything below it. This is what a scrolling
// 11-cell rail could never guarantee — the four destinations checked most
// (glance-first, per PRODUCT.md) always land in the same four spots.
const MOBILE_FIXED = GROUPS[0].items;
// Everything the "More" sheet holds, grouped under the same two labels
// (Monitor's items already live in the fixed cells, so that group is empty
// here and simply isn't rendered).
const SHEET_GROUPS = GROUPS.slice(1);

function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SideNav({ dockgeUrl }: { dockgeUrl: string }) {
  const pathname = usePathname();
  const { data } = useContainers(10000);
  const unhealthy = data?.counts.unhealthy ?? 0;

  const [sheetOpen, setSheetOpen] = useState(false);

  // Auto-close on route change — the sheet must never be the thing you have
  // to remember to dismiss after tapping a destination inside it.
  useEffect(() => {
    setSheetOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  async function logout() {
    // Signing out is a deliberate "I am done on this machine", and /logs now
    // keeps container output in IndexedDB — output that on this box carries
    // gluetun credentials, cloudflared tunnel tokens and *arr API keys.
    //
    // Session EXPIRY deliberately does not come through here: that is the
    // moment the archive is most useful, and the reader never chose to leave.
    // Imported here rather than at module scope: this nav renders on every
    // page, and a static import would put the whole IndexedDB layer in every
    // page's bundle to serve one click that happens once a session.
    await import("@/lib/log-archive")
      .then((m) => m.clearArchive())
      .catch(() => {
        // A storage failure must never trap someone in a signed-in session.
      });
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // The one destination inside the sheet that is currently active, if any —
  // this is what lets the "More" cell carry the active accent state instead
  // of going dark the moment the reader is looking at Images or Settings.
  const activeSheetItem = SHEET_GROUPS.flatMap((g) => g.items).find((item) =>
    isActive(item.href, pathname),
  );

  return (
    <>
      {/* desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-40 w-52 border-r border-line bg-panel/70 backdrop-blur flex-col">
        {/* brand */}
        <div className="px-4 pt-5 pb-4 border-b border-line">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-accent" />
            <span className="font-mono text-sm font-semibold tracking-wide">
              night<span className="text-accent">watch</span>
            </span>
          </div>
          <div className="microlabel mt-1">homelab · 192.168.1.70</div>
        </div>

        {/* nav, grouped under microlabel dividers — the same idiom the log
            rail uses to group chips by compose stack. Modest spacing between
            groups, no extra chrome. */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto">
          {GROUPS.map((group, gi) => (
            <div key={group.label} className={gi > 0 ? "mt-3" : undefined}>
              <div className="microlabel px-2.5 pb-1">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href, pathname);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.8rem] transition-colors",
                        active
                          ? "bg-accent/10 text-accent border border-accent/20"
                          : "text-ink-dim hover:text-ink hover:bg-panel-2 border border-transparent",
                      )}
                    >
                      <Icon size={15} />
                      {label}
                      {label === "Containers" && unhealthy > 0 && (
                        <span className="ml-auto dot dot-unhealthy" title={`${unhealthy} unhealthy`} />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* external + logout */}
        <div className="px-2 pb-4 space-y-0.5 border-t border-line pt-3">
          {/* Kiosk mode is a first-class surface, not an external link — the
              icon carries a quiet accent tint so it reads as "of this app"
              next to the two links below it, without matching the weight of
              an active nav item. */}
          <Link
            href="/kiosk"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.8rem] text-ink-dim hover:text-ink hover:bg-panel-2"
          >
            <Tv size={15} className="text-accent/70" />
            Kiosk mode
          </Link>
          <a
            href={dockgeUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.8rem] text-ink-dim hover:text-ink hover:bg-panel-2"
          >
            <ExternalLink size={15} />
            Stacks · Dockge
          </a>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.8rem] text-ink-dim hover:text-bad hover:bg-panel-2 cursor-pointer"
          >
            <LogOut size={15} />
            Log out
          </button>
        </div>
      </aside>

      {/* mobile top bar */}
      <header
        className="md:hidden sticky top-0 z-40 flex items-center justify-between border-b border-line bg-panel/90 backdrop-blur px-4"
        style={{ paddingTop: "env(safe-area-inset-top)", minHeight: "52px" }}
      >
        <div className="flex items-center gap-2 py-2">
          <Activity size={16} className="text-accent" />
          <span className="font-mono text-sm font-semibold tracking-wide">
            night<span className="text-accent">watch</span>
          </span>
        </div>
        <div className="flex items-center -mr-2">
          <a
            href={dockgeUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center h-11 w-11 text-ink-dim hover:text-ink active:text-ink"
            aria-label="Stacks · Dockge"
          >
            <ExternalLink size={17} />
          </a>
          <button
            onClick={logout}
            className="flex items-center justify-center h-11 w-11 text-ink-dim hover:text-bad active:text-bad cursor-pointer"
            aria-label="Log out"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>

      {/* mobile bottom tab bar — a stable 5-cell grid (the four Monitor
          destinations plus More), not the 11-cell scroll rail it replaces.
          The rail let the active tab load off-screen with no cue anything
          else existed; a fixed grid means every cell is always visible and
          the active one is always in the same place. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 border-t border-line bg-panel/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {MOBILE_FIXED.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 min-h-14 transition-colors active:bg-panel-2",
                active ? "text-accent" : "text-ink-dim",
              )}
            >
              <span className="relative">
                <Icon size={18} />
                {label === "Containers" && unhealthy > 0 && (
                  <span
                    className="absolute -top-0.5 -right-1 dot dot-unhealthy"
                    title={`${unhealthy} unhealthy`}
                  />
                )}
              </span>
              <span className="text-[0.625rem] leading-none w-full text-center truncate">
                {label}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          aria-label={activeSheetItem ? `More — currently on ${activeSheetItem.label}` : "More"}
          className={cn(
            "relative flex flex-col items-center justify-center gap-0.5 min-h-14 transition-colors active:bg-panel-2 cursor-pointer",
            activeSheetItem ? "text-accent" : "text-ink-dim",
          )}
        >
          {/* When the active route lives inside the sheet, the cell swaps in
              that page's own icon (rather than the generic dots) so current
              location is never invisible — the core failure of the old rail,
              where the active tab could be a screen and a half off-view. */}
          {activeSheetItem ? <activeSheetItem.icon size={18} /> : <MoreHorizontal size={18} />}
          <span className="text-[0.625rem] leading-none w-full text-center truncate">
            {activeSheetItem ? activeSheetItem.label : "More"}
          </span>
        </button>
      </nav>

      <MoreSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        pathname={pathname}
        unhealthy={unhealthy}
        dockgeUrl={dockgeUrl}
      />
    </>
  );
}

function MoreSheet({
  open,
  onClose,
  pathname,
  unhealthy,
  dockgeUrl,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  unhealthy: number;
  dockgeUrl: string;
}) {
  // Mounted vs. visible split so the slide-up (and its reverse on close) has
  // something to transition from/to instead of the panel just popping in —
  // this is the sheet's one authored moment, and it is a plain CSS
  // transition so `motion-reduce:` can flatten it to an instant cut.
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [open]);

  // Body scroll lock while the sheet is up — the content behind it must not
  // scroll along with a drag on the sheet itself.
  useEffect(() => {
    if (!mounted) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mounted]);

  // Escape closes it too, alongside the backdrop tap and the explicit close
  // affordance below.
  useEffect(() => {
    if (!mounted) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, onClose]);

  if (!mounted) return null;

  return (
    <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="More navigation">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-bg/80 backdrop-blur-sm transition-opacity duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none cursor-pointer",
          visible ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        className={cn(
          "panel absolute inset-x-0 bottom-0 max-h-[75vh] flex flex-col overflow-hidden transition-transform duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          visible ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-line flex-none">
          <span className="microlabel">More</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center h-11 w-11 -mr-2 text-ink-dim hover:text-ink active:text-ink cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div
          className="overflow-y-auto px-2 pt-2"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          {SHEET_GROUPS.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="microlabel px-2.5 pb-1">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href, pathname);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-2.5 min-h-11 text-sm transition-colors",
                        active
                          ? "bg-accent/10 text-accent border border-accent/20"
                          : "text-ink-dim hover:text-ink hover:bg-panel-2 border border-transparent",
                      )}
                    >
                      <Icon size={16} />
                      {label}
                      {label === "Containers" && unhealthy > 0 && (
                        <span className="ml-auto dot dot-unhealthy" title={`${unhealthy} unhealthy`} />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="border-t border-line pt-2 pb-1 space-y-0.5">
            <Link
              href="/kiosk"
              className="flex items-center gap-3 rounded-md px-2.5 min-h-11 text-sm text-ink-dim hover:text-ink hover:bg-panel-2"
            >
              <Tv size={16} className="text-accent/70" />
              Kiosk mode
            </Link>
            <a
              href={dockgeUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-md px-2.5 min-h-11 text-sm text-ink-dim hover:text-ink hover:bg-panel-2"
            >
              <ExternalLink size={16} />
              Stacks · Dockge
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

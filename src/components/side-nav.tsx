"use client";

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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useContainers } from "@/lib/client";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/resources", label: "Resources", icon: Gauge },
  { href: "/containers", label: "Containers", icon: Boxes },
  { href: "/images", label: "Images", icon: HardDrive },
  { href: "/volumes", label: "Volumes", icon: Database },
  // "Network", not "Networks": the page is no longer a docker-network inventory —
  // it is this box's network (uplink throughput, bridges, container footprint, ports).
  { href: "/networks", label: "Network", icon: Network },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SideNav({ dockgeUrl }: { dockgeUrl: string }) {
  const pathname = usePathname();
  const { data } = useContainers(10000);
  const unhealthy = data?.counts.unhealthy ?? 0;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

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

        {/* nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
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
        </nav>

        {/* external + logout */}
        <div className="px-2 pb-4 space-y-0.5 border-t border-line pt-3">
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

      {/* mobile bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-8 border-t border-line bg-panel/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                // overflow-hidden + px-0.5: the bar carries eight cells since the
                // log console joined it, which is ~45px each on a 360px phone.
                // "Containers" does not fit at that width and would collide with
                // its neighbours rather than clip, so the cell clamps its label.
                "relative flex flex-col items-center justify-center gap-0.5 min-h-14 overflow-hidden px-0.5 transition-colors active:bg-panel-2",
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
      </nav>
    </>
  );
}

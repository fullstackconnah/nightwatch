"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Boxes,
  HardDrive,
  Database,
  Network,
  Settings,
  ExternalLink,
  LogOut,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useContainers } from "@/lib/client";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/containers", label: "Containers", icon: Boxes },
  { href: "/images", label: "Images", icon: HardDrive },
  { href: "/volumes", label: "Volumes", icon: Database },
  { href: "/networks", label: "Networks", icon: Network },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SideNav({ dockgeUrl }: { dockgeUrl: string }) {
  const pathname = usePathname();
  const { data } = useContainers(10000);
  const unhealthy = data?.counts.unhealthy ?? 0;

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-52 border-r border-line bg-panel/70 backdrop-blur flex flex-col">
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
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/login";
          }}
          className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.8rem] text-ink-dim hover:text-bad hover:bg-panel-2 cursor-pointer"
        >
          <LogOut size={15} />
          Log out
        </button>
      </div>
    </aside>
  );
}

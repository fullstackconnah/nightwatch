"use client";
/* The 404's one button, split out so not-found.tsx stays a server component: only the path decides where it goes. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { notFoundHome } from "@/lib/not-found-home";

export function NotFoundHomeLink() {
  const { href, label } = notFoundHome(usePathname());
  return (
    <Link
      href={href}
      className="h-11 md:h-9 w-full rounded-md border border-accent/30 bg-accent/10 text-accent text-sm font-medium flex items-center justify-center gap-1.5 outline-none hover:bg-accent/20 focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] transition"
    >
      <ArrowLeft size={14} aria-hidden="true" />
      {label}
    </Link>
  );
}

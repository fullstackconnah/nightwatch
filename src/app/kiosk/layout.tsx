import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "kiosk · nightwatch",
};

/**
 * Standalone shell for the wall-tablet ambient display — no SideNav, no
 * max-w-7xl content column. Deliberately its own top-level route (a sibling
 * of (dash), not nested inside it) so nothing from the authenticated
 * dashboard shell leaks in here, since /kiosk is reachable without a session.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-bg overflow-x-hidden">{children}</div>;
}

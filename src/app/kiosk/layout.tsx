import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "kiosk · nightwatch",
  // PWA surface for iPads: Add to Home Screen installs /kiosk as a
  // standalone full-screen app (no Safari chrome). iOS ignores most of the
  // manifest and reads its own apple-* tags instead, so both are declared —
  // the manifest for spec-compliant browsers, appleWebApp for iPadOS.
  manifest: "/kiosk.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "nightwatch",
  },
  icons: {
    apple: "/kiosk-icon-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#070b11",
  // cover + the safe-area padding below: in standalone mode the page draws
  // under the iPad's status bar / home indicator; without this the status
  // strip sits beneath the clock readout.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // A wall/tablet control surface, not a document — pinch-zoom off keeps
  // accidental zooms from stranding the kiosk in a scrolled-in state.
  maximumScale: 1,
  userScalable: false,
};

/**
 * Standalone shell for the wall-tablet ambient display — no SideNav, no
 * max-w-7xl content column. Deliberately its own top-level route (a sibling
 * of (dash), not nested inside it) so nothing from the authenticated
 * dashboard shell leaks in here, since /kiosk is reachable without a session.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-bg overflow-x-hidden"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {children}
    </div>
  );
}

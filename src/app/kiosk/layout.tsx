import type { Metadata, Viewport } from "next";
import { KioskThemeScope } from "@/components/kiosk-theme";
import { KioskSky } from "@/components/kiosk-sky";

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
  // Next's appleWebApp.capable emits only the MODERN standard tag
  // (mobile-web-app-capable), but iOS full-screen launch still keys off the
  // legacy apple- variant — and on a plain-HTTP origin iOS also ignores the
  // manifest's display:standalone, so this tag is the only thing standing
  // between Add-to-Home-Screen and a Safari-chromed bookmark. Observed live.
  other: {
    "apple-mobile-web-app-capable": "yes",
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
  // The shell div (bg, safe-area padding, and the device-local theme
  // attribute) lives in KioskThemeScope so this layout stays a server
  // component and keeps its metadata/viewport exports.
  // KioskSky mounts here (as a child of the scope) rather than inside
  // KioskThemeScope itself: kiosk-sky imports useKioskTheme from
  // kiosk-theme, so the reverse import would create a module cycle.
  return (
    <KioskThemeScope>
      <KioskSky />
      {children}
    </KioskThemeScope>
  );
}

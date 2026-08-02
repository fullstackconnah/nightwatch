import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "homelab · nightwatch",
  description: "Single pane of glass for the homelab",
  // The whole dashboard installs as an iOS home-screen app, same mechanism
  // as /kiosk (whose own layout overrides these keys with kiosk-specific
  // values — Next merges metadata per segment, most-specific wins). Status
  // bar is opaque "black" here, not the kiosk's black-translucent: the dash
  // shell has a top nav and no safe-area padding, so content must start
  // BELOW the system bar rather than draw beneath it.
  manifest: "/dashboard.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "nightwatch",
  },
  icons: {
    apple: "/kiosk-icon-180.png",
  },
  // Next's appleWebApp.capable emits only the modern standard tag; iOS
  // full-screen launch still needs the legacy apple- variant on a plain-HTTP
  // origin (same reasoning as kiosk/layout.tsx, observed on device).
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#070b11",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

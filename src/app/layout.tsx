import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "homelab · nightwatch",
  description: "Single pane of glass for the homelab",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

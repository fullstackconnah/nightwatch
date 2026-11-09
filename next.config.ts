import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    // The kiosk is unauthenticated on the LAN by design and a wall display may be framed by another
    // dashboard, so it alone skips the framing headers; everything else is denied as a frame.
    return [
      { source: "/:path*", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
      ] },
      { source: "/((?!kiosk(?:/|$)).*)", headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      ] },
    ];
  },
  serverExternalPackages: ["dockerode", "systeminformation", "ssh2"],
  images: {
    // Icons come from selfh.st / arbitrary label URLs; don't proxy-optimize them.
    unoptimized: true,
  },
};

export default nextConfig;

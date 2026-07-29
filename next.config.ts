import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["dockerode", "systeminformation", "ssh2"],
  images: {
    // Icons come from selfh.st / arbitrary label URLs; don't proxy-optimize them.
    unoptimized: true,
  },
};

export default nextConfig;

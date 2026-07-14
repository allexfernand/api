import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/mds", destination: "/" }];
  },
};

export default nextConfig;

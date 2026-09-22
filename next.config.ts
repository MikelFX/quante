import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Qads moved out of the Studio (was /project/:id/ads/...) and into a
      // standalone generator at /qads that doesn't tie to a specific project.
      // 308 (permanent, preserves method) rather than 307 so search engines +
      // deep links from old emails / OG previews permanently forward.
      { source: '/project/:id/ads', destination: '/qads', permanent: true },
      { source: '/project/:id/ads/:path*', destination: '/qads', permanent: true },
    ]
  },
};

export default nextConfig;

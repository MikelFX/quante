import type { NextConfig } from "next";

// Baseline security headers for every platform response. Deliberately NO script-src
// CSP yet: Clerk, Stripe and Supabase need an allowlist rolled out in Report-Only
// first. frame-ancestors 'self' (+ X-Frame-Options for old browsers) stops other
// sites from framing the Studio / billing to clickjack paid actions, while the
// same-origin /preview/* iframe inside the Studio keeps working.
// /api/preview/component is excluded: it sets its own sandboxing CSP.
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), usb=()' },
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/((?!api/preview/component).*)', headers: securityHeaders },
    ]
  },
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

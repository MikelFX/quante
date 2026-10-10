import type { NextConfig } from "next";
import { withBotId } from 'botid/next/config';
import { APP_HOST_PATTERN, APP_ORIGIN, APP_PATHS, SITE_HOST_PATTERN, SITE_ORIGIN, SITE_PATHS } from './lib/domains';

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
      // Domain split (lib/domains.ts): the website lives on assetradigital.agency, the app on
      // quantecode.com. Each host sends the other surface's paths across; /api/* never moves.
      // Previews and localhost match neither host and keep serving both surfaces.
      ...SITE_PATHS.map((source) => ({
        source,
        has: [{ type: 'host' as const, value: APP_HOST_PATTERN }],
        destination: SITE_ORIGIN + source,
        permanent: true,
      })),
      ...APP_PATHS.map((source) => ({
        source,
        has: [{ type: 'host' as const, value: SITE_HOST_PATTERN }],
        destination: APP_ORIGIN + source,
        permanent: true,
      })),
      // Qads moved out of the Studio (was /project/:id/ads/...) and into a
      // standalone generator at /qads that doesn't tie to a specific project.
      // 308 (permanent, preserves method) rather than 307 so search engines +
      // deep links from old emails / OG previews permanently forward.
      { source: '/project/:id/ads', destination: '/qads', permanent: true },
      { source: '/project/:id/ads/:path*', destination: '/qads', permanent: true },
      // The old English Quante marketing pages are replaced by the Czech AssetraDigital site
      // (app/(site)). Exact paths only — never a wildcard that could catch /api/* routes.
      { source: '/pricing', destination: '/quante#cenik', permanent: true },
      { source: '/showcase', destination: '/quante/generate', permanent: true },
      { source: '/about', destination: '/', permanent: true },
      { source: '/domains', destination: '/quante', permanent: true },
      { source: '/contact', destination: '/#kontakt', permanent: true },
      { source: '/api', destination: '/quante', permanent: true },
    ]
  },
};

// Vercel BotID: invisible bot check for the public AssetraDigital endpoints (instrumentation-client.ts
// lists them; the routes call checkBotId()).
export default withBotId(nextConfig);

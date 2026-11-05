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

// RFC 8288 Link header on every page: where an agent finds the machine-readable versions.
const AGENT_LINK_HEADER = [
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</api/agent/v1/openapi.json>; rel="service-desc"; type="application/openapi+json"',
  '</api/agent/v1/catalog>; rel="service-meta"; type="application/json"',
  '</api/mcp>; rel="mcp"',
].join(', ')

// "/x/:path*" as two rules: compiled into an absolute destination, an empty :path* leaves a
// trailing slash ("https://host/x/"), which then costs a second redirect.
function hostRedirects(paths: readonly string[], host: string, origin: string) {
  const has = [{ type: 'host' as const, value: host }]
  return paths.flatMap((p) => {
    const sources = p.endsWith('/:path*') ? [p.slice(0, -'/:path*'.length), p.slice(0, -1) + '+'] : [p]
    return sources.map((source) => ({ source, has, destination: origin + source, permanent: true }))
  })
}

const nextConfig: NextConfig = {
  // The Qads community wall's light previews are made with the static ffmpeg binary
  // (lib/qads/community-preview.ts): loaded from node_modules at runtime and shipped with that route.
  serverExternalPackages: ['ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/qads/community': ['./node_modules/ffmpeg-static/ffmpeg'],
  },
  async headers() {
    return [
      { source: '/((?!api/preview/component).*)', headers: securityHeaders },
      // Agents (lib/agents): every page points at the machine-readable layer (RFC 8288 Link).
      { source: '/((?!api/|_next/).*)', headers: [{ key: 'Link', value: AGENT_LINK_HEADER }] },
    ]
  },
  async rewrites() {
    return {
      // quantecode.com/ shows the Quante overview (app/(site)/(quante)/quante); the URL stays "/".
      beforeFiles: [{ source: '/', has: [{ type: 'host', value: APP_HOST_PATTERN }], destination: '/quante' }],
      // The agent layer (lib/agents, owner 2026-11-05): same files on both hosts, served by /api/agent/*.
      afterFiles: [
        { source: '/robots.txt', destination: '/api/agent/robots' },
        { source: '/llms.txt', destination: '/api/agent/llms' },
        { source: '/llms-full.txt', destination: '/api/agent/llms-full' },
        { source: '/.well-known/:file*', destination: '/api/agent/well-known/:file*' },
      ],
      fallback: [],
    }
  },
  async redirects() {
    return [
      // Domain split (lib/domains.ts): the website lives on assetradigital.agency, the app on
      // quantecode.com. Each host sends the other surface's paths across; /api/* never moves.
      // Previews and localhost match neither host and keep serving both surfaces.
      // Except "/": quantecode.com/ is the Quante overview (rewrites below, owner 2026-11-04).
      ...hostRedirects(SITE_PATHS.filter((p) => p !== '/'), APP_HOST_PATTERN, SITE_ORIGIN),
      ...hostRedirects(APP_PATHS, SITE_HOST_PATTERN, APP_ORIGIN),
      // The Quante product pages (QUANTE_PATHS) live on quantecode.com, its overview at the root.
      { source: '/quante', has: [{ type: 'host', value: SITE_HOST_PATTERN }], destination: APP_ORIGIN + '/', permanent: true },
      { source: '/quante/:path+', has: [{ type: 'host', value: SITE_HOST_PATTERN }], destination: APP_ORIGIN + '/quante/:path+', permanent: true },
      { source: '/quante', has: [{ type: 'host', value: APP_HOST_PATTERN }], destination: '/', permanent: true },
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

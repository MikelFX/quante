import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { APP_ORIGIN, SITE_ORIGIN, hostKind } from '@/lib/domains'

// Robots directives per host (lib/domains.ts). The app routes render the auth-gated Studio and
// generated storefront previews that have no SEO value and shouldn't appear in search results.
// API routes return JSON, are not user-facing, and can be crawler-noise if indexed. Everything
// else — the public pages enumerated in sitemap.ts — is allowed.

export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const kind = hostKind(host)
  const origin = kind === 'site' ? SITE_ORIGIN
    : kind === 'app' ? APP_ORIGIN
      : `${h.get('x-forwarded-proto') ?? 'https'}://${host ?? 'localhost'}`

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/dashboard',
          '/billing',
          '/settings',
          '/admin',
          '/new',
          '/project/',
          '/marketplace',
          '/preview/',
          '/invoice/',
        ],
      },
    ],
    sitemap: new URL('/sitemap.xml', origin).toString(),
    host: new URL(origin).host,
  }
}

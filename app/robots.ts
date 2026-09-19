import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

// Robots directives for quantecode.com. The (app)/ and (preview)/ route
// groups render auth-gated Studio + generated storefront previews that
// have no SEO value and shouldn't appear in search results. API routes
// return JSON, are not user-facing, and can be crawler-noise if indexed.
// Everything else — the marketing surface enumerated in sitemap.ts — is
// allowed.

export default function robots(): MetadataRoute.Robots {
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
    sitemap: new URL('/sitemap.xml', SITE_URL).toString(),
    host: new URL(SITE_URL).host,
  }
}

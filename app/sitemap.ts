import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { modules } from '@/content/assetra/modules'
import { APP_ORIGIN, SITE_ORIGIN, hostKind } from '@/lib/domains'

// Sitemap per host (lib/domains.ts): assetradigital.agency lists the AssetraDigital website (Czech),
// quantecode.com the Quante pages that are still public (Qads generator, changelog, legal).
// Previews and localhost list both, on their own origin. The old English marketing pages redirect
// (next.config.ts) and are not listed; the AssetraDigital document pages stay out until they have
// real text (they are noindex placeholders).
//
// robots.ts disallows /api/*, the app and the store previews, so this sitemap only enumerates URLs
// Google is allowed to crawl.

type Entry = { path: string; priority: number; changeFrequency: 'yearly' | 'monthly' | 'weekly' }

const SITE: Entry[] = [
  { path: '/',       priority: 1.0, changeFrequency: 'monthly' },
  { path: '/quante', priority: 0.9, changeFrequency: 'monthly' },
  ...modules.map((m) => ({ path: '/quante/' + m.slug, priority: m.status === 'live' ? 0.8 : 0.5, changeFrequency: 'monthly' as const })),
]

const APP: Entry[] = [
  { path: '/qads',      priority: 0.7, changeFrequency: 'monthly' },
  { path: '/changelog', priority: 0.4, changeFrequency: 'weekly'  },
  { path: '/terms',     priority: 0.2, changeFrequency: 'yearly'  },
  { path: '/privacy',   priority: 0.2, changeFrequency: 'yearly'  },
  { path: '/refund',    priority: 0.2, changeFrequency: 'yearly'  },
  { path: '/cookies',   priority: 0.2, changeFrequency: 'yearly'  },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const kind = hostKind(host)
  const shared = `${h.get('x-forwarded-proto') ?? 'https'}://${host ?? 'localhost'}`
  const entries: Array<[string, Entry]> =
    kind === 'site' ? SITE.map((e) => [SITE_ORIGIN, e])
      : kind === 'app' ? APP.map((e) => [APP_ORIGIN, e])
        : [...SITE, ...APP].map((e) => [shared, e])

  const now = new Date()
  return entries.map(([origin, { path, priority, changeFrequency }]) => ({
    url: new URL(path, origin).toString(),
    lastModified: now,
    changeFrequency,
    priority,
  }))
}

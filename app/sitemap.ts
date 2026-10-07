import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'
import { modules } from '@/content/assetra/modules'

// Static sitemap for the public surface: the AssetraDigital website (Czech) plus the Quante
// pages that are still public (Qads generator, changelog, legal). Every route here is
// prerendered, so lastModified reflects deploy time. The old English marketing pages redirect
// (next.config.ts) and are not listed; the AssetraDigital document pages stay out until they
// have real text (they are noindex placeholders).
//
// robots.ts disallows /api/*, /(app)/* and /(preview)/*, so this sitemap only enumerates URLs
// Google is allowed to crawl.

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  const publicRoutes: Array<{ path: string; priority: number; changeFrequency: 'yearly' | 'monthly' | 'weekly' }> = [
    { path: '/',          priority: 1.0, changeFrequency: 'monthly' },
    { path: '/quante',    priority: 0.9, changeFrequency: 'monthly' },
    ...modules.map((m) => ({ path: '/quante/' + m.slug, priority: m.status === 'live' ? 0.8 : 0.5, changeFrequency: 'monthly' as const })),
    { path: '/qads',      priority: 0.7, changeFrequency: 'monthly' },
    { path: '/changelog', priority: 0.4, changeFrequency: 'weekly'  },
    { path: '/terms',     priority: 0.2, changeFrequency: 'yearly'  },
    { path: '/privacy',   priority: 0.2, changeFrequency: 'yearly'  },
    { path: '/refund',    priority: 0.2, changeFrequency: 'yearly'  },
    { path: '/cookies',   priority: 0.2, changeFrequency: 'yearly'  },
  ]

  return publicRoutes.map(({ path, priority, changeFrequency }) => ({
    url: new URL(path, SITE_URL).toString(),
    lastModified: now,
    changeFrequency,
    priority,
  }))
}

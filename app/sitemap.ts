import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

// Static sitemap for the public marketing surface. Every route here is
// prerendered (○ Static in `next build` output) so lastModified reflects
// deploy time; a per-route lastModified would need a build hook and
// isn't worth the complexity yet. When app routes (/dashboard, /billing,
// etc.) become worth indexing — they aren't, they're behind auth and
// have zero SEO value — add them here.
//
// robots.ts disallows /api/*, /(app)/* and /(preview)/*, so this sitemap
// only enumerates URLs Google is allowed to crawl.

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  const publicRoutes: Array<{ path: string; priority: number; changeFrequency: 'yearly' | 'monthly' | 'weekly' }> = [
    { path: '/',          priority: 1.0, changeFrequency: 'monthly' },
    { path: '/pricing',   priority: 0.9, changeFrequency: 'monthly' },
    { path: '/showcase',  priority: 0.8, changeFrequency: 'monthly' },
    { path: '/qads',      priority: 0.7, changeFrequency: 'monthly' },
    { path: '/about',     priority: 0.6, changeFrequency: 'monthly' },
    { path: '/domains',   priority: 0.5, changeFrequency: 'monthly' },
    { path: '/changelog', priority: 0.4, changeFrequency: 'weekly'  },
    { path: '/contact',   priority: 0.4, changeFrequency: 'yearly'  },
    { path: '/api',       priority: 0.3, changeFrequency: 'monthly' },
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

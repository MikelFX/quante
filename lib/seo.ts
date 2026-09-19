// Single builder for every page's Next.js Metadata object.
//
// Marketing pages call buildMetadata({ title, description, path, ... }) to
// produce a Metadata block that already carries the right absolute
// canonical URL, Open Graph + Twitter cards pointing at the current
// path, and the site-wide title suffix. Keeping this in one place means
// a marketing tweak (change the site suffix, swap the OG image, add a
// robots meta) is one edit, not one per route.
//
// Char limits per the audit brief 3:
//   title       — plain page title, buildMetadata appends " — Quante"
//                 automatically; keep the input under ~45 chars so the
//                 final <title> stays under Google's 60-char snippet cap.
//   description — 155 chars max (Google's snippet cap). buildMetadata
//                 warns in dev if this is exceeded.

import type { Metadata } from 'next'

/**
 * Public base URL used for absolute canonical / OG image URLs. Set
 * NEXT_PUBLIC_SITE_URL in Vercel; the fallback matches production. Accepts
 * `quantecode.com`, `https://quantecode.com`, `//quantecode.com`, etc. —
 * the normaliser always returns a fully-qualified https origin so
 * `new URL(path, SITE_URL)` in downstream helpers can't throw.
 */
function normaliseSiteUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return 'https://quantecode.com'
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return 'https:' + trimmed
  return 'https://' + trimmed
}

export const SITE_URL: string = normaliseSiteUrl(
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://quantecode.com',
)

/** Site-wide title suffix appended by buildMetadata. */
export const SITE_NAME = 'Quante'

/** Default meta description for pages that don't override it. */
export const DEFAULT_DESCRIPTION =
  'Describe an online store — Quante generates a real Next.js project you can export and own outright.'

interface BuildMetadataInput {
  /** Page-specific title, e.g. "Pricing". Appended with " — Quante". */
  title: string
  /** Meta description — keep ≤155 chars. */
  description: string
  /** Route path starting with "/". Used for canonical + og:url. */
  path: string
  /**
   * Optional OG image URL override. Absolute or root-relative. If unset,
   * the site-wide app/opengraph-image.tsx dynamic default is used, which
   * Next.js automatically serves under /opengraph-image.
   */
  ogImage?: string
  /** Optional keywords override (rarely useful for SEO — leave blank by default). */
  keywords?: string[]
  /** Robots override — pass { noindex: true } for pages that shouldn't rank. */
  robots?: 'index' | 'noindex'
}

export function buildMetadata(input: BuildMetadataInput): Metadata {
  const { title, description, path, ogImage, keywords, robots = 'index' } = input
  const canonical = new URL(path, SITE_URL).toString()
  const fullTitle = `${title} — ${SITE_NAME}`

  // Dev-time nudges so no page ships an SEO-hostile snippet unnoticed.
  if (process.env.NODE_ENV !== 'production') {
    if (fullTitle.length > 60) {
      // eslint-disable-next-line no-console
      console.warn(`[seo] "${fullTitle}" is ${fullTitle.length} chars — trim under 60 for search snippets.`)
    }
    if (description.length > 155) {
      // eslint-disable-next-line no-console
      console.warn(`[seo] description on ${path} is ${description.length} chars — trim under 155.`)
    }
  }

  return {
    title: fullTitle,
    description,
    keywords,
    alternates: { canonical },
    robots: robots === 'noindex'
      ? { index: false, follow: false }
      : { index: true, follow: true, googleBot: { index: true, follow: true } },
    openGraph: {
      title: fullTitle,
      description,
      url: canonical,
      siteName: SITE_NAME,
      type: 'website',
      images: ogImage ? [{ url: absUrl(ogImage) }] : undefined,
      locale: 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: ogImage ? [absUrl(ogImage)] : undefined,
    },
  }
}

/** Resolve a root-relative URL against SITE_URL. Absolute URLs pass through. */
export function absUrl(u: string): string {
  if (/^https?:\/\//i.test(u)) return u
  return new URL(u, SITE_URL).toString()
}

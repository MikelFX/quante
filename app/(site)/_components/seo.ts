import type { Metadata } from 'next'
import { SITE_ORIGIN } from '@/lib/domains'

// Share + canonical metadata for the website pages. URLs are relative: the site layout sets
// metadataBase to the website's own host (lib/domains.ts). Every page passes its share image
// explicitly — a child page's openGraph replaces the parent's, it is not merged.

export const siteOgImage = { url: '/og', width: 1200, height: 630, alt: 'Assetra Digital — AI řešení a software na míru' }

export function siteShare({ path, title, description, type }: { path: string; title: string; description: string; type?: 'website' }): Metadata {
  return {
    alternates: { canonical: path },
    openGraph: { ...(type ? { type } : {}), locale: 'cs_CZ', siteName: 'Assetra Digital', url: path, title, description, images: [siteOgImage] },
    twitter: { card: 'summary_large_image', title, description, images: [siteOgImage.url] },
  }
}

/** Quante's share card (app/(site)/og/quante), by its absolute URL: /og lives on the website host. */
export const quanteOgImage = { url: SITE_ORIGIN + '/og/quante', width: 1200, height: 630, alt: 'Quante — celý e-shop na jednom místě' }

/** Share + canonical metadata for the Quante pages (quantecode.com, (quante)/layout.tsx sets
 *  metadataBase to the app host). Every Quante page exists in Czech and English: `path` is this
 *  page, `alternate` the Czech and English paths, sent as hreflang (x-default = Czech). */
export function quanteShare({ path, title, description, locale = 'cs', alternate }: {
  path: string
  title: string
  description: string
  locale?: 'cs' | 'en'
  alternate?: { cs: string; en: string }
}): Metadata {
  const image = quanteOgImage
  return {
    alternates: {
      canonical: path,
      ...(alternate ? { languages: { cs: alternate.cs, en: alternate.en, 'x-default': alternate.cs } } : {}),
    },
    openGraph: { locale: locale === 'en' ? 'en_US' : 'cs_CZ', ...(alternate ? { alternateLocale: locale === 'en' ? 'cs_CZ' : 'en_US' } : {}), siteName: 'Quante', url: path, title, description, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  }
}

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

/** Share + canonical metadata for the Quante pages (quantecode.com, (quante)/layout.tsx sets
 *  metadataBase to the app host). The share image is the website's /og, by its absolute URL. */
export function quanteShare({ path, title, description }: { path: string; title: string; description: string }): Metadata {
  const image = { ...siteOgImage, url: SITE_ORIGIN + siteOgImage.url, alt: 'Quante od AssetraDigital' }
  return {
    alternates: { canonical: path },
    openGraph: { locale: 'cs_CZ', siteName: 'Quante', url: path, title, description, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  }
}

import type { Metadata } from 'next'

// Share + canonical metadata for the website pages. URLs are relative: the site layout sets
// metadataBase to the website's own host (lib/domains.ts). Every page passes its share image
// explicitly — a child page's openGraph replaces the parent's, it is not merged.

export const siteOgImage = { url: '/og', width: 1200, height: 630, alt: 'Assetra Digital — web nebo e-shop bez vstupní investice' }

export function siteShare({ path, title, description, type }: { path: string; title: string; description: string; type?: 'website' }): Metadata {
  return {
    alternates: { canonical: path },
    openGraph: { ...(type ? { type } : {}), locale: 'cs_CZ', siteName: 'Assetra Digital', url: path, title, description, images: [siteOgImage] },
    twitter: { card: 'summary_large_image', title, description, images: [siteOgImage.url] },
  }
}

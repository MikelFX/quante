// Types that Claude generates when producing store code directly.
// These are used in code_versions.files (the new approach replacing ShopManifest).

export interface StoreProduct {
  id: string
  name: string
  description: string
  price: number
  compareAtPrice?: number
  images: string[]
  slug: string
  available: boolean
  tags?: string[]
  variants?: Array<{ id: string; name: string; price?: number; stock?: number }>
  lowStockThreshold?: number
}

export interface StoreConfig {
  brand: {
    name: string
    tagline: string
    currency: string  // ISO 4217, e.g. "CZK", "EUR"
    language: string  // e.g. "cs", "en"
    logoText?: string
  }
  seo: { title: string; description: string }
  design: {
    colors: {
      bg: string
      text: string
      accent: string
      accentText: string
      muted: string
      surface: string
      border: string
    }
    fonts: { heading: string; body: string }
    radius: string  // CSS value e.g. "8px"
  }
  nav: Array<{ label: string; href: string }>
  footer: {
    columns: Array<{ title: string; links: Array<{ label: string; href: string }> }>
    legal: string
    socials?: Array<{ platform: string; url: string }>
  }
}

// The structured output Claude produces during generation
export interface StoreCodeOutput {
  files: Record<string, string>  // { filepath: content }
  summary: string  // 1-2 sentence description of what was generated
}

// Stored in code_versions.files
export type CodeVersionFiles = Record<string, string>

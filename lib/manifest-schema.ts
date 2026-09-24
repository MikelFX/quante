import { z } from 'zod'

// ─── Render-safety helpers ────────────────────────────────────────────────────
// Manifest strings are attacker-controllable (AI output steered by user text, or a
// hand-edited body sent to /api/manifest/save). Values that end up in CSS (palette,
// fonts, hero background url()) or in href attributes are validated here so a stored
// manifest can never inject CSS declarations / markup or a script URL. Invalid values
// fall back to safe defaults via .catch() instead of failing the whole manifest.

// Mirrors the allowlist given to the model in lib/claude.ts.
export const ALLOWED_HEADING_FONTS = [
  'Inter', 'Playfair Display', 'Space Grotesk', 'DM Serif Display', 'Fraunces', 'Raleway',
  'Montserrat', 'Cormorant Garamond', 'Libre Baskerville',
] as const
export const ALLOWED_BODY_FONTS = [
  'Inter', 'DM Sans', 'Source Sans 3', 'Lato', 'Open Sans', 'Nunito', 'Plus Jakarta Sans', 'Outfit',
] as const
const ALLOWED_FONTS_BY_LOWER = new Map<string, string>(
  [...ALLOWED_HEADING_FONTS, ...ALLOWED_BODY_FONTS].map((f) => [f.toLowerCase(), f])
)
// Google Font family names are letters, digits and spaces. Anything else (quotes,
// semicolons, braces, parens, <, newlines) could break out of `"<font>", serif` in CSS.
const SAFE_FONT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,47}$/

/**
 * Canonical allowlisted font name, or — for Google fonts outside the allowlist that the
 * Studio's reference-image flow can pick — the name itself if it is a plain family name.
 * Returns null for anything that is not a safe family name.
 */
export function normalizeFontName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/\s+/g, ' ')
  const allowlisted = ALLOWED_FONTS_BY_LOWER.get(name.toLowerCase())
  if (allowlisted) return allowlisted
  return SAFE_FONT_NAME_RE.test(name) ? name : null
}

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
// Functional notation with numeric/keyword arguments only — no nested functions
// (var(), url()), no quotes, semicolons, braces or angle brackets.
const FN_COLOR_RE = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[0-9a-z.,%/+\s-]{1,80}\)$/i
const NAMED_COLOR_RE = /^[a-z]{3,20}$/i

/** True for a plain CSS color (hex, rgb/hsl/oklch/... functional notation, or a named color). */
export function isSafeCssColor(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const v = value.trim()
  return HEX_COLOR_RE.test(v) || FN_COLOR_RE.test(v) || NAMED_COLOR_RE.test(v)
}

const SAFE_HREF_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'sms'])

/** Relative/fragment links, or absolute links with an http(s)/mailto/tel/sms scheme. */
export function isSafeHref(value: unknown): value is string {
  if (typeof value !== 'string') return false
  // Browsers ignore whitespace/control characters inside a scheme ("java\tscript:").
  const compact = value.replace(/[\s\u0000-\u001f\u007f-\u009f]/g, '').toLowerCase()
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(compact)
  return !scheme || SAFE_HREF_SCHEMES.has(scheme[1])
}

/** Image URL that is also safe inside an unquoted CSS url(...). */
export function isSafeImageSrc(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  if (/["'()\\;{}<>\s]/.test(value)) return false
  return /^(https?:\/\/|\/(?!\/)|data:image\/(png|jpe?g|gif|webp|avif);base64,)/i.test(value)
}

const PALETTE_FALLBACKS = {
  bg: '#ffffff',
  surface: '#f5f5f4',
  text: '#111111',
  muted: '#6b7280',
  accent: '#111111',
  accentText: '#ffffff',
  border: '#e5e5e5',
} as const
const FONT_FALLBACK = 'Inter'

/**
 * Re-applies the palette / font render-safety rules to a manifest that did NOT come
 * through ShopManifestSchema (e.g. a manifest_versions row stored before these rules
 * existed). Use it wherever a raw DB manifest reaches CSS: the /preview renderer
 * (manifestToCssVars / buildFontUrl) and the export / hosting build. Everything else in
 * the manifest is passed through untouched; the input is not mutated.
 */
export function sanitizeManifestForRender<T>(manifest: T): T {
  if (!manifest || typeof manifest !== 'object') return manifest
  const m = manifest as unknown as { design?: unknown }
  if (!m.design || typeof m.design !== 'object') return manifest
  const design = m.design as { palette?: unknown; typography?: unknown }
  const rawPalette = (design.palette && typeof design.palette === 'object' ? design.palette : {}) as Record<string, unknown>
  const palette: Record<string, unknown> = { ...rawPalette }
  for (const [key, fallback] of Object.entries(PALETTE_FALLBACKS)) {
    const v = rawPalette[key]
    palette[key] = isSafeCssColor(v) ? v.trim() : fallback
  }
  const rawTypo = (design.typography && typeof design.typography === 'object' ? design.typography : {}) as Record<string, unknown>
  const typography = {
    ...rawTypo,
    headingFont: normalizeFontName(rawTypo.headingFont) ?? FONT_FALLBACK,
    bodyFont: normalizeFontName(rawTypo.bodyFont) ?? FONT_FALLBACK,
  }
  return { ...m, design: { ...design, palette, typography } } as unknown as T
}

const cssColor = (fallback: string) =>
  z.string().trim().refine((v) => isSafeCssColor(v)).catch(fallback)

const fontName = (fallback: string) =>
  z.string().transform((v) => normalizeFontName(v) ?? fallback).catch(fallback)

const safeHref = z.string().transform((v) => (isSafeHref(v) ? v : '#'))
const optionalSafeHref = safeHref.optional()
const optionalSafeImageSrc = z
  .string()
  .optional()
  .transform((v) => (v !== undefined && isSafeImageSrc(v) ? v : undefined))
  .catch(undefined)

const MerchantSchema = z.object({
  obchodni_nazev: z.string(),
  ico: z.string(),
  dic: z.string().optional(),
  platce_dph: z.boolean().default(false),
  sidlo: z.object({
    ulice: z.string(),
    mesto: z.string(),
    psc: z.string(),
    zeme: z.string().default('CZ'),
  }),
  kontakt: z.object({ email: z.string(), telefon: z.string() }),
  bankovni_ucet: z.string().optional(),
  zodpovedna_osoba: z.string().optional(),
})

const ShippingMethodSchema = z.object({
  type: z.enum(['zasilkovna', 'packeta_international', 'dhl', 'ppl', 'dpd', 'balikovna', 'osobni_odber', 'custom']),
  nazev: z.string().optional(),
  cena_czk: z.coerce.number(),
})

const ShippingConfigSchema = z.object({
  methods: z.array(ShippingMethodSchema),
  doprava_zdarma_od_czk: z.coerce.number().optional(),
})

const PaymentsConfigSchema = z.object({
  providers: z.array(z.enum(['comgate', 'gopay', 'stripe', 'paypal'])),
  dobirka: z.object({ enabled: z.boolean(), priplatek_czk: z.coerce.number() }).optional(),
  prevod: z.object({ enabled: z.boolean(), qr: z.boolean() }).optional(),
})

const ProductVariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string().optional(),
  price: z.coerce.number().optional(),
  stock: z.coerce.number().int().min(0).optional(),
})

const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  price: z.coerce.number(),
  compareAtPrice: z.coerce.number().optional(),
  images: z.array(z.string()),
  slug: z.string(),
  available: z.coerce.boolean(),
  tags: z.array(z.string()).optional(),
  variants: z.array(ProductVariantSchema).optional(),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
})

const CollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  productIds: z.array(z.string()),
})

const HeroPropsSchema = z.object({
  headline: z.string(),
  subheadline: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaHref: optionalSafeHref,
  secondaryCtaLabel: z.string().optional(),
  secondaryCtaHref: optionalSafeHref,
  // Rendered inside an unquoted CSS url(...) by the Hero section.
  imageSrc: optionalSafeImageSrc,
  layout: z.enum(['centered', 'split', 'fullbleed']).optional().default('centered').catch('centered'),
})

const ProductGridPropsSchema = z.object({
  title: z.string().optional(),
  collectionId: z.string().optional(),
  limit: z.coerce.number().optional(),
  columns: z.coerce.number().min(1).max(4).optional(),
})

const FeatureRowPropsSchema = z.object({
  title: z.string().optional(),
  features: z.array(
    z.object({ icon: z.string().optional(), title: z.string(), description: z.string().default('') })
  ),
  layout: z.enum(['grid', 'list']).optional().default('grid').catch('grid'),
})

const TestimonialsPropsSchema = z.object({
  title: z.string().optional(),
  items: z.array(
    z.object({
      quote: z.string(),
      author: z.string(),
      role: z.string().optional(),
      avatar: z.string().optional(),
    })
  ),
  marquee: z.boolean().optional(),
})

const RichTextPropsSchema = z.object({
  content: z.string().default(''),
  align: z.enum(['left', 'center']).optional(),
})

const BannerPropsSchema = z.object({
  text: z.string().default(''),
  ctaLabel: z.string().optional(),
  ctaHref: optionalSafeHref,
})

const NewsletterPropsSchema = z.object({
  title: z.string().default(''),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  buttonLabel: z.string().optional(),
})

const GalleryPropsSchema = z.object({
  images: z.array(z.object({ src: z.string(), alt: z.string() })),
  columns: z.coerce.number().min(1).max(4).optional(),
})

const FaqPropsSchema = z.object({
  title: z.string().optional(),
  items: z.array(z.object({ question: z.string(), answer: z.string() })),
})

const AnimationsPropsSchema = z.object({
  variant: z.enum(['marquee', 'stats', 'spotlight']).optional().default('marquee'),
  title: z.string().optional(),
  items: z.array(z.string()).optional(),
  stats: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  productSlug: z.string().optional(),
})

export const SectionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hero'), props: HeroPropsSchema }),
  z.object({ type: z.literal('productGrid'), props: ProductGridPropsSchema }),
  z.object({ type: z.literal('featureRow'), props: FeatureRowPropsSchema }),
  z.object({ type: z.literal('testimonials'), props: TestimonialsPropsSchema }),
  z.object({ type: z.literal('richText'), props: RichTextPropsSchema }),
  z.object({ type: z.literal('banner'), props: BannerPropsSchema }),
  z.object({ type: z.literal('newsletter'), props: NewsletterPropsSchema }),
  z.object({ type: z.literal('gallery'), props: GalleryPropsSchema }),
  z.object({ type: z.literal('faq'), props: FaqPropsSchema }),
  z.object({ type: z.literal('animations'), props: AnimationsPropsSchema }),
  z.object({ type: z.literal('customComponent'), ref: z.string() }),
])

const NavItemSchema: z.ZodType<{
  label: string
  href: string
  children?: Array<{ label: string; href: string }>
}> = z.object({
  label: z.string(),
  href: safeHref,
  children: z
    .array(z.object({ label: z.string(), href: safeHref }))
    .optional(),
})

export const ShopManifestSchema = z.object({
  version: z.string(),
  merchant: MerchantSchema.optional(),
  payments: PaymentsConfigSchema.optional(),
  shipping: ShippingConfigSchema.optional(),
  brand: z.object({
    name: z.string(),
    tagline: z.string(),
    voice: z.enum(['minimal', 'editorial', 'playful', 'luxury', 'technical']).catch('minimal'),
    logoText: z.string(),
  }),
  design: z.object({
    // Palette values land in CSS custom properties (and the custom-component iframe's
    // <style>), so only plain colors are accepted; anything else gets a safe default.
    palette: z.object({
      bg: cssColor(PALETTE_FALLBACKS.bg),
      surface: cssColor(PALETTE_FALLBACKS.surface),
      text: cssColor(PALETTE_FALLBACKS.text),
      muted: cssColor(PALETTE_FALLBACKS.muted),
      accent: cssColor(PALETTE_FALLBACKS.accent),
      accentText: cssColor(PALETTE_FALLBACKS.accentText),
      border: cssColor(PALETTE_FALLBACKS.border),
    }),
    typography: z.object({
      headingFont: fontName(FONT_FALLBACK),
      bodyFont: fontName(FONT_FALLBACK),
      scale: z.enum(['compact', 'comfortable', 'spacious']).catch('comfortable'),
    }),
    radius: z.enum(['none', 'sm', 'md', 'lg', 'full']).catch('md'),
    density: z.enum(['tight', 'normal', 'airy']).catch('normal'),
    motion: z.enum(['none', 'subtle', 'expressive']).catch('subtle'),
  }),
  catalog: z.object({
    currency: z.string(),
    products: z.array(ProductSchema),
    collections: z.array(CollectionSchema).optional(),
  }),
  pages: z.object({
    home: z.array(SectionSchema),
    product: z.array(SectionSchema),
    collection: z.array(SectionSchema),
    about: z.array(SectionSchema).optional(),
    contact: z.array(SectionSchema).optional(),
  }),
  nav: z.array(NavItemSchema),
  footer: z.object({
    columns: z.array(
      z.object({
        title: z.string(),
        links: z.array(z.object({ label: z.string(), href: safeHref })),
      })
    ),
    legal: z.string(),
    socials: z.array(
      z.object({
        platform: z.enum(['twitter', 'instagram', 'facebook', 'tiktok', 'youtube', 'linkedin']),
        url: safeHref,
      })
    ),
  }),
  seo: z.object({ title: z.string(), description: z.string() }),
  customPages: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      sections: z.array(SectionSchema),
    })
  ).optional(),
  adminPanel: z.boolean().optional(),
})

export type ValidatedShopManifest = z.infer<typeof ShopManifestSchema>

export function parseManifestJson(raw: string): ValidatedShopManifest {
  // Strip markdown code fences
  let cleaned = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  // If Claude prepended prose, extract the JSON object
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace > 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1)
  }

  const json = JSON.parse(cleaned)
  return ShopManifestSchema.strip().parse(json)
}

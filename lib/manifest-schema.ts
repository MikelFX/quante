import { z } from 'zod'

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
  type: z.enum(['zasilkovna', 'ppl', 'dpd', 'balikovna', 'osobni_odber', 'custom']),
  nazev: z.string().optional(),
  cena_czk: z.coerce.number(),
})

const ShippingConfigSchema = z.object({
  methods: z.array(ShippingMethodSchema),
  doprava_zdarma_od_czk: z.coerce.number().optional(),
})

const PaymentsConfigSchema = z.object({
  providers: z.array(z.enum(['comgate', 'gopay', 'stripe'])),
  dobirka: z.object({ enabled: z.boolean(), priplatek_czk: z.coerce.number() }).optional(),
  prevod: z.object({ enabled: z.boolean(), qr: z.boolean() }).optional(),
})

const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  price: z.coerce.number(),
  images: z.array(z.string()),
  slug: z.string(),
  available: z.coerce.boolean(),
  tags: z.array(z.string()).optional(),
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
  ctaHref: z.string().optional(),
  secondaryCtaLabel: z.string().optional(),
  secondaryCtaHref: z.string().optional(),
  imageSrc: z.string().optional(),
  layout: z.enum(['centered', 'split', 'fullbleed']).optional().default('centered'),
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
    z.object({ icon: z.string().optional(), title: z.string(), description: z.string() })
  ),
  layout: z.enum(['grid', 'list']),
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
})

const RichTextPropsSchema = z.object({
  content: z.string().default(''),
  align: z.enum(['left', 'center']).optional(),
})

const BannerPropsSchema = z.object({
  text: z.string().default(''),
  ctaLabel: z.string().optional(),
  ctaHref: z.string().optional(),
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
  variant: z.enum(['marquee', 'stats', 'spotlight']),
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
  href: z.string(),
  children: z
    .array(z.object({ label: z.string(), href: z.string() }))
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
    voice: z.enum(['minimal', 'editorial', 'playful', 'luxury', 'technical']),
    logoText: z.string(),
  }),
  design: z.object({
    palette: z.object({
      bg: z.string(),
      surface: z.string(),
      text: z.string(),
      muted: z.string(),
      accent: z.string(),
      accentText: z.string(),
      border: z.string(),
    }),
    typography: z.object({
      headingFont: z.string(),
      bodyFont: z.string(),
      scale: z.enum(['compact', 'comfortable', 'spacious']),
    }),
    radius: z.enum(['none', 'sm', 'md', 'lg', 'full']),
    density: z.enum(['tight', 'normal', 'airy']),
    motion: z.enum(['none', 'subtle', 'expressive']),
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
        links: z.array(z.object({ label: z.string(), href: z.string() })),
      })
    ),
    legal: z.string(),
    socials: z.array(
      z.object({
        platform: z.enum(['twitter', 'instagram', 'facebook', 'tiktok', 'youtube', 'linkedin']),
        url: z.string(),
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

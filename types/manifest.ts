export type BrandVoice = 'minimal' | 'editorial' | 'playful' | 'luxury' | 'technical'
export type MotionLevel = 'none' | 'subtle' | 'expressive'
export type RadiusLevel = 'none' | 'sm' | 'md' | 'lg' | 'full'
export type DensityLevel = 'tight' | 'normal' | 'airy'
export type ScaleLevel = 'compact' | 'comfortable' | 'spacious'

export interface ProductVariant {
  id: string
  name: string       // e.g. "Small / Red"
  sku?: string
  price?: number     // overrides product base price when set
  stock?: number     // manifest-level stock (used in ZIP exports; hosted stores use store_inventory table)
}

export interface Product {
  id: string
  name: string
  description: string
  price: number
  compareAtPrice?: number      // original price for sale display; shown as strikethrough when > price
  images: string[]
  slug: string
  available: boolean
  tags?: string[]
  variants?: ProductVariant[]  // size/color/etc. options; if present, user must pick one before adding to cart
  lowStockThreshold?: number   // alert merchant when stock falls to or below this value
}

export interface Collection {
  id: string
  name: string
  slug: string
  description?: string
  productIds: string[]
}

export type Section =
  | { type: 'hero'; props: HeroProps }
  | { type: 'productGrid'; props: ProductGridProps }
  | { type: 'featureRow'; props: FeatureRowProps }
  | { type: 'testimonials'; props: TestimonialsProps }
  | { type: 'richText'; props: RichTextProps }
  | { type: 'banner'; props: BannerProps }
  | { type: 'newsletter'; props: NewsletterProps }
  | { type: 'gallery'; props: GalleryProps }
  | { type: 'faq'; props: FaqProps }
  | { type: 'animations'; props: AnimationsProps }
  | { type: 'customComponent'; ref: string }

export interface HeroProps {
  headline: string
  subheadline?: string
  ctaLabel: string
  ctaHref: string
  secondaryCtaLabel?: string
  secondaryCtaHref?: string
  imageSrc?: string
  layout: 'centered' | 'split' | 'fullbleed'
}

export interface ProductGridProps {
  title?: string
  collectionId?: string
  limit?: number
  columns?: 2 | 3 | 4
}

export interface FeatureRowProps {
  title?: string
  features: Array<{ icon?: string; title: string; description: string }>
  layout: 'grid' | 'list'
}

export interface TestimonialsProps {
  title?: string
  items: Array<{ quote: string; author: string; role?: string; avatar?: string }>
  marquee?: boolean
}

export interface RichTextProps {
  content: string
  align?: 'left' | 'center'
}

export interface BannerProps {
  text: string
  ctaLabel?: string
  ctaHref?: string
}

export interface NewsletterProps {
  title: string
  description?: string
  placeholder?: string
  buttonLabel?: string
}

export interface GalleryProps {
  images: Array<{ src: string; alt: string }>
  columns?: 2 | 3 | 4
}

export interface FaqProps {
  title?: string
  items: Array<{ question: string; answer: string }>
}

export interface AnimationsProps {
  variant: 'marquee' | 'stats' | 'spotlight'
  title?: string
  items?: string[]
  stats?: { value: string; label: string }[]
  productSlug?: string
}

export interface CustomPage {
  slug: string      // kebab-case, no leading slash, e.g. "doprava" or "vraceni-zbozi"
  title: string     // page title shown in <title> and as hero heading
  sections: Section[]
}

export interface NavItem {
  label: string
  href: string
  children?: NavItem[]
}

export interface FooterColumn {
  title: string
  links: Array<{ label: string; href: string }>
}

export interface Social {
  platform: 'twitter' | 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'linkedin'
  url: string
}

export interface MerchantAddress {
  ulice: string
  mesto: string
  psc: string
  zeme: string
}

export interface Merchant {
  obchodni_nazev: string
  ico: string
  dic?: string
  platce_dph: boolean
  sidlo: MerchantAddress
  kontakt: { email: string; telefon: string }
  bankovni_ucet?: string
  zodpovedna_osoba?: string
}

export interface ShippingMethod {
  type: 'zasilkovna' | 'packeta_international' | 'dhl' | 'ppl' | 'dpd' | 'balikovna' | 'osobni_odber' | 'custom'
  nazev?: string
  cena_czk: number
}

export interface ShippingConfig {
  methods: ShippingMethod[]
  doprava_zdarma_od_czk?: number
}

export interface PaymentDobirka {
  enabled: boolean
  priplatek_czk: number
}

export interface PaymentPrevod {
  enabled: boolean
  qr: boolean
}

export interface PaymentsConfig {
  providers: Array<'comgate' | 'gopay' | 'stripe' | 'paypal'>
  dobirka?: PaymentDobirka
  prevod?: PaymentPrevod
}

export interface ShopManifest {
  version: string

  merchant?: Merchant

  payments?: PaymentsConfig

  shipping?: ShippingConfig

  adminPanel?: boolean

  brand: {
    name: string
    tagline: string
    voice: BrandVoice
    logoText: string
  }

  design: {
    palette: {
      bg: string
      surface: string
      text: string
      muted: string
      accent: string
      accentText: string
      border: string
    }
    typography: {
      headingFont: string
      bodyFont: string
      scale: ScaleLevel
    }
    radius: RadiusLevel
    density: DensityLevel
    motion: MotionLevel
  }

  catalog: {
    currency: string
    products: Product[]
    collections?: Collection[]
  }

  pages: {
    home: Section[]
    product: Section[]
    collection: Section[]
    about?: Section[]
    contact?: Section[]
  }

  /** Arbitrary extra pages — each gets a URL at /<slug> */
  customPages?: CustomPage[]

  nav: NavItem[]
  footer: {
    columns: FooterColumn[]
    legal: string
    socials: Social[]
  }
  seo: {
    title: string
    description: string
  }
}

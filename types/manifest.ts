export type BrandVoice = 'minimal' | 'editorial' | 'playful' | 'luxury' | 'technical'
export type MotionLevel = 'none' | 'subtle' | 'expressive'
export type RadiusLevel = 'none' | 'sm' | 'md' | 'lg' | 'full'
export type DensityLevel = 'tight' | 'normal' | 'airy'
export type ScaleLevel = 'compact' | 'comfortable' | 'spacious'

export interface Product {
  id: string
  name: string
  description: string
  price: number
  images: string[]
  slug: string
  available: boolean
  tags?: string[]
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

export interface ShopManifest {
  version: string

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

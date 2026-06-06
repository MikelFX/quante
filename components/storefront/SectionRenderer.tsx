import type { Section, ShopManifest } from '@/types/manifest'
import { Hero } from './sections/Hero'
import { ProductGrid } from './sections/ProductGrid'
import { FeatureRow } from './sections/FeatureRow'
import { Testimonials } from './sections/Testimonials'
import { RichText } from './sections/RichText'
import { Banner } from './sections/Banner'
import { Newsletter } from './sections/Newsletter'
import { Gallery } from './sections/Gallery'
import { Faq } from './sections/Faq'
import { Animations } from './sections/Animations'

interface Props {
  section: Section
  manifest: ShopManifest
  basePath?: string
}

export function SectionRenderer({ section, manifest, basePath = '' }: Props) {
  switch (section.type) {
    case 'hero':
      return <Hero props={section.props} basePath={basePath} />
    case 'productGrid':
      return <ProductGrid props={section.props} catalog={manifest.catalog} basePath={basePath} />
    case 'featureRow':
      return <FeatureRow props={section.props} />
    case 'testimonials':
      return <Testimonials props={section.props} />
    case 'richText':
      return <RichText props={section.props} />
    case 'banner':
      return <Banner props={section.props} />
    case 'newsletter':
      return <Newsletter props={section.props} />
    case 'gallery':
      return <Gallery props={section.props} />
    case 'faq':
      return <Faq props={section.props} />
    case 'animations':
      return <Animations props={section.props} catalog={manifest.catalog} />
    case 'customComponent':
      return null
    default:
      return null
  }
}

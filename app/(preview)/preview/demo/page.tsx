import { ShopRenderer } from '@/components/storefront/ShopRenderer'
import { AURA_MANIFEST } from '@/lib/sample-manifest'

export const metadata = {
  title: AURA_MANIFEST.seo.title,
  description: AURA_MANIFEST.seo.description,
}

export default function PreviewDemoPage() {
  return <ShopRenderer manifest={AURA_MANIFEST} />
}

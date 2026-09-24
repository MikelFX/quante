import { loadOwnedPreviewManifest } from '@/app/(preview)/_lib/owned-manifest'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'
import type { ShopManifest } from '@/types/manifest'

interface Props { params: Promise<{ id: string; slug: string }> }

export default async function PreviewCollectionPage({ params }: Props) {
  const { id, slug } = await params
  const manifestRow = await loadOwnedPreviewManifest(id)
  const data = manifestRow ? { manifest: manifestRow } : null
  const manifest = data?.manifest as ShopManifest | undefined
  if (!manifest) return <div style={{ padding: '4rem', textAlign: 'center', color: '#666' }}>No manifest.</div>
  const collection = manifest.catalog.collections?.find((c) => c.slug === slug)
  if (!collection) return <div style={{ padding: '4rem', textAlign: 'center', color: '#666' }}>Collection not found.</div>
  return <ShopRenderer manifest={manifest} page="collection" basePath={`/preview/${id}`} projectId={id} />
}

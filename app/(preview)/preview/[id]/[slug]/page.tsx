import { notFound } from 'next/navigation'
import { loadOwnedPreviewManifest } from '@/app/(preview)/_lib/owned-manifest'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'
import type { ShopManifest } from '@/types/manifest'

interface Props { params: Promise<{ id: string; slug: string }> }

export default async function PreviewCustomPage({ params }: Props) {
  const { id, slug } = await params
  const manifestRow = await loadOwnedPreviewManifest(id)
  const data = manifestRow ? { manifest: manifestRow } : null

  if (!data?.manifest) return <div style={{ padding: '4rem', textAlign: 'center', color: '#666' }}>No manifest.</div>

  const manifest = data.manifest as ShopManifest
  const page = manifest.customPages?.find((p) => p.slug === slug)
  if (!page) notFound()

  return <ShopRenderer manifest={manifest} customSlug={slug} basePath={`/preview/${id}`} projectId={id} />
}

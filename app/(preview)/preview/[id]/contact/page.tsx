import { loadOwnedPreviewManifest } from '@/app/(preview)/_lib/owned-manifest'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'
import type { ShopManifest } from '@/types/manifest'

interface Props { params: Promise<{ id: string }> }

export default async function PreviewContactPage({ params }: Props) {
  const { id } = await params
  const manifestRow = await loadOwnedPreviewManifest(id)
  const data = manifestRow ? { manifest: manifestRow } : null
  if (!data?.manifest) return <div style={{ padding: '4rem', textAlign: 'center', color: '#666' }}>No manifest.</div>
  return <ShopRenderer manifest={data.manifest as ShopManifest} page="contact" basePath={`/preview/${id}`} projectId={id} />
}

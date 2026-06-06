import { createClient } from '@/lib/supabase/server'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'
import type { ShopManifest } from '@/types/manifest'

interface Props { params: Promise<{ id: string; slug: string }> }

export default async function PreviewCollectionPage({ params }: Props) {
  const { id, slug } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('manifest_versions').select('manifest')
    .eq('project_id', id).order('version_no', { ascending: false }).limit(1).maybeSingle()
  const manifest = data?.manifest as ShopManifest | undefined
  if (!manifest) return <div style={{ padding: '4rem', textAlign: 'center', color: '#666' }}>No manifest.</div>
  const collection = manifest.catalog.collections?.find((c) => c.slug === slug)
  if (!collection) return <div style={{ padding: '4rem', textAlign: 'center', color: '#666' }}>Collection not found.</div>
  return <ShopRenderer manifest={manifest} page="collection" basePath={`/preview/${id}`} />
}

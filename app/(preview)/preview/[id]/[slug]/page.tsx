import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'
import type { ShopManifest } from '@/types/manifest'

interface Props { params: Promise<{ id: string; slug: string }> }

export default async function PreviewCustomPage({ params }: Props) {
  const { id, slug } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('manifest_versions').select('manifest')
    .eq('project_id', id).order('version_no', { ascending: false }).limit(1).maybeSingle()

  if (!data?.manifest) return <div style={{ padding: '4rem', textAlign: 'center', color: '#666' }}>No manifest.</div>

  const manifest = data.manifest as ShopManifest
  const page = manifest.customPages?.find((p) => p.slug === slug)
  if (!page) notFound()

  return <ShopRenderer manifest={manifest} customSlug={slug} basePath={`/preview/${id}`} />
}

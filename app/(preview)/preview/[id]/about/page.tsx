import { createClient } from '@/lib/supabase/server'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'
import type { ShopManifest } from '@/types/manifest'

interface Props { params: Promise<{ id: string }> }

export default async function PreviewAboutPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('manifest_versions').select('manifest')
    .eq('project_id', id).order('version_no', { ascending: false }).limit(1).maybeSingle()
  if (!data?.manifest) return <div style={{ padding: '4rem', textAlign: 'center', color: '#666' }}>No manifest.</div>
  return <ShopRenderer manifest={data.manifest as ShopManifest} page="about" basePath={`/preview/${id}`} />
}

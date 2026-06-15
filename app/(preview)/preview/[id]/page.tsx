import { createClient } from '@/lib/supabase/server'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'
import type { ShopManifest } from '@/types/manifest'

interface Props {
  params: Promise<{ id: string }>
}

export default async function PreviewPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data } = await supabase
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.manifest) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          color: '#666',
          fontSize: '0.875rem',
        }}
      >
        No manifest found for this project.
      </div>
    )
  }

  return <ShopRenderer manifest={data.manifest as ShopManifest} basePath={`/preview/${id}`} projectId={id} />
}

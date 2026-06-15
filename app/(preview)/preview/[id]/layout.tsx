import { createClient } from '@/lib/supabase/server'
import { StoreShell } from '@/components/storefront/StoreShell'
import type { ShopManifest } from '@/types/manifest'

interface Props {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function StoreLayout({ children, params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data } = await supabase
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const manifest = data?.manifest as ShopManifest | undefined
  const currency = manifest?.catalog.currency ?? ''
  const basePath = `/preview/${id}`

  return (
    <StoreShell basePath={basePath} currency={currency}>
      {children}
    </StoreShell>
  )
}

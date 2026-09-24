import { loadOwnedPreviewManifest } from '@/app/(preview)/_lib/owned-manifest'
import { StoreShell } from '@/components/storefront/StoreShell'
import type { ShopManifest } from '@/types/manifest'

interface Props {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function StoreLayout({ children, params }: Props) {
  const { id } = await params
  const manifestRow = await loadOwnedPreviewManifest(id)
  const data = manifestRow ? { manifest: manifestRow } : null

  const manifest = data?.manifest as ShopManifest | undefined
  const currency = manifest?.catalog.currency ?? ''
  const basePath = `/preview/${id}`

  return (
    <StoreShell basePath={basePath} currency={currency}>
      {children}
    </StoreShell>
  )
}

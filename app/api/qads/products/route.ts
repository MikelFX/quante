// GET /api/qads/products — list the signed-in user's Quante-generated
// products so the /qads box can offer "@ pick from your store" (pre-fills the
// product name and description). Purely a convenience — the user can always
// type the copy and upload their own photos.
//
// Code-generated stores (the current kind): data/products.ts of the latest
// code version, parsed as a literal (lib/store-products.ts) or, when the file
// uses constants, read leniently for names + descriptions only. Older
// manifest stores: the latest manifest_versions catalog. Read-only. Each store also lists its
// brand kit photos (brandPhotos) for the composer.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { productsFromCode, productsFromManifest, type ManifestSlice, type PickerProduct } from '@/lib/qads/store-catalog'
import { getBrandKits } from '@/lib/brand-kit/store'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Every project the user owns.
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id, name')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(30)
  if (!projects || projects.length === 0) return NextResponse.json({ projects: [] })

  const projectIds = projects.map(p => p.id as string)
  const { data: manifests } = await supabaseAdmin
    .from('manifest_versions')
    .select('project_id, manifest, version_no')
    .in('project_id', projectIds)
    .order('version_no', { ascending: false })

  // Keep only the latest manifest per project.
  const latestByProject = new Map<string, ManifestSlice>()
  for (const row of manifests ?? []) {
    const pid = row.project_id as string
    if (!latestByProject.has(pid)) latestByProject.set(pid, (row.manifest as ManifestSlice) ?? {})
  }

  // Code-generated stores: data/products.ts of each project's latest code version.
  const codeProducts = new Map<string, PickerProduct[]>()
  await Promise.all(projectIds.map(async (pid) => {
    const { data } = await supabaseAdmin
      .from('code_versions')
      .select('files')
      .eq('project_id', pid)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle()
    const list = productsFromCode((data?.files as Record<string, string> | undefined) ?? null)
    if (list.length) codeProducts.set(pid, list)
  }))

  // Brand kit photos (lib/brand-kit): offered as product photos; copied into qads-inputs only
  // when picked (POST /api/qads/upload/brand).
  const { kits } = await getBrandKits(projectIds, userId)

  const out = projects
    .map(p => {
      const manifest = latestByProject.get(p.id as string)
      const products: PickerProduct[] = codeProducts.get(p.id as string) ?? productsFromManifest(manifest)
      return {
        projectId: p.id,
        projectName: (p.name as string) || (manifest?.brand?.name ?? 'Untitled project'),
        products,
        brandPhotos: kits.get(p.id as string)?.photos.slice(0, 12) ?? [],
      }
    })
    .filter(p => p.products.length > 0 || p.brandPhotos.length > 0)

  return NextResponse.json({ projects: out })
}

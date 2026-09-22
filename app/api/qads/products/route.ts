// GET /api/qads/products — list the signed-in user's Quante-generated
// products so the /qads form can offer a "pick from your store" shortcut
// (pre-fills name, description, and photo URLs). Purely a convenience —
// user can always upload their own photos and type the copy manually.
//
// Reads from manifest_versions the same way the storefront preview does;
// we surface the current (latest per project) manifest's catalog only.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface ManifestProduct {
  id: string
  name: string
  description?: string
  images?: string[]
  price?: number
  slug?: string
}

interface ManifestSlice {
  brand?: { name?: string }
  catalog?: { products?: ManifestProduct[] }
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Every project the user owns, plus its latest manifest_versions row (the
  // storefront's current catalog).
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

  const out = projects
    .map(p => {
      const manifest = latestByProject.get(p.id as string)
      const catalog = manifest?.catalog?.products ?? []
      const products = catalog.slice(0, 60).map(prod => ({
        id: prod.id,
        name: prod.name,
        description: prod.description ?? '',
        images: (prod.images ?? []).slice(0, 4),
      }))
      return {
        projectId: p.id,
        projectName: (p.name as string) || (manifest?.brand?.name ?? 'Untitled project'),
        products,
      }
    })
    .filter(p => p.products.length > 0)

  return NextResponse.json({ projects: out })
}

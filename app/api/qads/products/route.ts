// GET /api/qads/products — list the signed-in user's Quante-generated
// products so the /qads box can offer "@ pick from your store" (pre-fills the
// product name and description). Purely a convenience — the user can always
// type the copy and upload their own photos.
//
// Code-generated stores (the current kind): data/products.ts of the latest
// code version, parsed as a literal (lib/store-products.ts) or, when the file
// uses constants, read leniently for names + descriptions only. Older
// manifest stores: the latest manifest_versions catalog. Read-only.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { PRODUCTS_FILE, parseProductsFile } from '@/lib/store-products'

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

interface PickerProduct { id: string; name: string; description: string; images: string[] }

/** The value of `key: "…"` (any quote style) in a piece of source, or null. */
function stringField(body: string, key: string): string | null {
  const m = body.match(new RegExp(`\\b${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\])*?)\\1`))
  // Unescape \" \' \\ and friends: the text as a shopper sees it.
  return m ? m[2].replace(/\\(.)/g, '$1') : null
}

/** Names and descriptions from a data/products.ts that isn't a plain literal. */
function readProductsLeniently(src: string): PickerProduct[] {
  const out: PickerProduct[] = []
  // Every "{" opens a chunk; products carry a slug, their variants don't.
  for (const chunk of src.split('{').slice(1)) {
    const body = chunk.split('}')[0]
    if (!/\bslug\s*:/.test(body)) continue
    const name = stringField(body, 'name')
    if (!name) continue
    out.push({
      id: stringField(body, 'id') ?? String(out.length + 1),
      name: name.slice(0, 120),
      description: (stringField(body, 'description') ?? '').slice(0, 600),
      images: [],
    })
    if (out.length >= 60) break
  }
  return out
}

function productsFromCode(files: Record<string, string> | null | undefined): PickerProduct[] {
  const src = files?.[PRODUCTS_FILE]
  if (typeof src !== 'string') return []
  const parsed = parseProductsFile(src)
  if (parsed) {
    return parsed.slice(0, 60).map((p) => ({
      id: String(p.id),
      name: p.name,
      description: p.description ?? '',
      images: (p.images ?? []).slice(0, 4),
    }))
  }
  return readProductsLeniently(src)
}

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

  const out = projects
    .map(p => {
      const manifest = latestByProject.get(p.id as string)
      const catalog = manifest?.catalog?.products ?? []
      const products: PickerProduct[] = codeProducts.get(p.id as string) ?? catalog.slice(0, 60).map(prod => ({
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

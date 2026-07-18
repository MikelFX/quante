import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { parseProductsFile, sanitizeProduct, serializeProductsFile, PRODUCTS_FILE } from '@/lib/store-products'
import type { CodeVersionFiles } from '@/types/store-code'

interface Params { params: Promise<{ id: string }> }

async function loadLatestVersion(projectId: string, userId: string) {
  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects').select('id').eq('id', projectId).eq('user_id', userId).maybeSingle()
  if (!project) return null

  const { data: version } = await supabase
    .from('code_versions')
    .select('id, version_no, files')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return version ?? null
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const version = await loadLatestVersion(id, userId)
  if (!version) return Response.json({ error: 'No generated store found' }, { status: 404 })

  const files = version.files as CodeVersionFiles
  const content = files[PRODUCTS_FILE]
  if (!content) return Response.json({ error: 'No products file in this store' }, { status: 404 })

  const products = parseProductsFile(content)
  const currencyMatch = (files['data/config.ts'] ?? '').match(/currency:\s*['"]([A-Za-z]{3})['"]/)

  return Response.json({
    products: products ?? [],
    editable: products !== null,
    currency: currencyMatch?.[1] ?? 'CZK',
    versionId: version.id,
  })
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { products?: unknown }
  if (!Array.isArray(body.products) || body.products.length > 200) {
    return Response.json({ error: 'products array required (max 200)' }, { status: 400 })
  }

  const products = []
  for (const raw of body.products) {
    if (typeof raw !== 'object' || raw === null) {
      return Response.json({ error: 'Invalid product entry' }, { status: 400 })
    }
    const clean = sanitizeProduct(raw as Record<string, unknown>)
    if (!clean) return Response.json({ error: 'Each product needs a name and a valid price' }, { status: 400 })
    products.push(clean)
  }

  const version = await loadLatestVersion(id, userId)
  if (!version) return Response.json({ error: 'No generated store found' }, { status: 404 })

  const files = { ...(version.files as CodeVersionFiles) }
  files[PRODUCTS_FILE] = serializeProductsFile(products)

  const { data: newVersion, error } = await supabaseAdmin
    .from('code_versions')
    .insert({
      project_id: id,
      user_id: userId,
      version_no: (version.version_no ?? 0) + 1,
      files,
      prompt: 'Manual product edit (admin)',
    })
    .select('id, version_no')
    .single()

  if (error || !newVersion) {
    console.error('[products PUT]', error)
    return Response.json({ error: 'Failed to save products' }, { status: 500 })
  }

  await supabaseAdmin.from('projects')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id)

  return Response.json({ ok: true, versionId: newVersion.id, versionNo: newVersion.version_no, products })
}

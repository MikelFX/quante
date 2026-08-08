// GET  /api/marketplace/listings           — public browse (status='listed' only, no code/snapshot)
// POST /api/marketplace/listings            — publish a component or a starter store as a listing
//
// Publishing takes a SNAPSHOT of the source at publish time (see migration-marketplace.sql's
// header comment) — later edits to the original component/project never retroactively
// change an already-published listing.

import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const MAX_PRICE_CENTS = 100_000 // $1,000 sanity cap — infrastructure phase, no real charge occurs anyway

export async function GET(request: Request) {
  const url = new URL(request.url)
  const kind = url.searchParams.get('kind')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '30', 10) || 30, 100)

  let query = supabaseAdmin
    .from('marketplace_listings')
    .select('id, kind, title, description, price_cents, currency, seller_user_id, created_at')
    .eq('status', 'listed')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (kind === 'component' || kind === 'starter_store') query = query.eq('kind', kind)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ listings: data ?? [] })
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const kind = body.kind
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : null
  const priceCents = Number.isFinite(body.priceCents) ? Math.max(0, Math.floor(body.priceCents)) : 0

  if (kind !== 'component' && kind !== 'starter_store') {
    return Response.json({ error: "kind must be 'component' or 'starter_store'" }, { status: 400 })
  }
  if (!title) return Response.json({ error: 'title is required' }, { status: 400 })
  if (priceCents > MAX_PRICE_CENTS) {
    return Response.json({ error: `priceCents may not exceed ${MAX_PRICE_CENTS}` }, { status: 400 })
  }

  if (kind === 'component') {
    const componentId = body.componentId
    if (typeof componentId !== 'string') return Response.json({ error: 'componentId is required' }, { status: 400 })

    const { data: component } = await supabaseAdmin
      .from('custom_components')
      .select('id, name, code, passed_validation, project_id, projects!inner(user_id)')
      .eq('id', componentId)
      .maybeSingle()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ownerId = (component as any)?.projects?.user_id
    if (!component || ownerId !== userId) {
      return Response.json({ error: 'Component not found' }, { status: 404 })
    }

    const passedValidation = !!component.passed_validation
    const { data, error } = await supabaseAdmin
      .from('marketplace_listings')
      .insert({
        seller_user_id: userId,
        kind: 'component',
        source_component_id: component.id,
        source_project_id: component.project_id,
        snapshot: { name: component.name, code: component.code },
        title,
        description,
        price_cents: priceCents,
        passed_validation: passedValidation,
        // Already went through the sandboxed component-generation validator (CLAUDE.md
        // §4.3) — safe to list immediately. Everything else needs admin review.
        status: passedValidation ? 'listed' : 'pending',
      })
      .select('id, kind, title, status')
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ listing: data }, { status: 201 })
  }

  // kind === 'starter_store'
  const projectId = body.projectId
  if (typeof projectId !== 'string') return Response.json({ error: 'projectId is required' }, { status: 400 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })

  const { data: version } = await supabaseAdmin
    .from('code_versions')
    .select('files')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!version?.files) return Response.json({ error: 'Project has no generated code to publish yet' }, { status: 422 })

  const { data, error } = await supabaseAdmin
    .from('marketplace_listings')
    .insert({
      seller_user_id: userId,
      kind: 'starter_store',
      source_project_id: projectId,
      snapshot: { files: version.files },
      title,
      description,
      price_cents: priceCents,
      passed_validation: false,
      status: 'pending', // full code exports always require admin review before listing
    })
    .select('id, kind, title, status')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ listing: data }, { status: 201 })
}

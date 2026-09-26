// Studio theme panel for code-gen stores (2026-09-26).
//
// GET → { theme, editable, fonts, versionId, versionNo } — the theme of the latest code
//       version's data/config.ts (editable=false when the file isn't a plain literal the
//       panel can rewrite; the panel then points the merchant to the chat).
// PUT { theme } → saves a new code version (a DRAFT: nothing is built or deployed —
//       the Studio already shows the change live through the preview bridge, and it
//       reaches shoppers with the next Publish). Free, no AI involved.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { rateLimit } from '@/lib/rate-limit'
import { filterAiStoreFiles } from '@/lib/store-template/build'
import { THEME_FONT_OPTIONS } from '@/lib/store-theme-shared'
import { CONFIG_FILE, readTheme, sanitizeTheme, writeTheme } from '@/lib/store-theme'
import type { CodeVersionFiles } from '@/types/store-code'

interface Params { params: Promise<{ id: string }> }

async function loadLatest(projectId: string) {
  const { data } = await supabaseAdmin
    .from('code_versions')
    .select('id, version_no, files')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as { id: string; version_no: number; files: CodeVersionFiles } | null
}

const FONT_LIST = THEME_FONT_OPTIONS.map(({ name, stack, kind }) => ({ name, stack, kind }))

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const project = await getOwnedProject<{ id: string }>(id, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const latest = await loadLatest(project.id)
  if (!latest) return NextResponse.json({ error: 'No generated store found.' }, { status: 404 })
  const source = latest.files?.[CONFIG_FILE]
  const theme = typeof source === 'string' ? readTheme(source) : null
  const editable = !!theme && typeof source === 'string' && writeTheme(source, theme) !== null

  return NextResponse.json({ theme, editable, fonts: FONT_LIST, versionId: latest.id, versionNo: latest.version_no })
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const project = await getOwnedProject<{ id: string }>(id, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Each save is a new code version row — the panel debounces, this caps the rest.
  if (!rateLimit(`theme:${userId}`, 60, 10 * 60 * 1000).allowed) {
    return NextResponse.json({ error: 'Too many theme saves. Please wait a moment.' }, { status: 429 })
  }

  const body = await request.json().catch(() => null) as { theme?: unknown } | null
  const theme = sanitizeTheme(body?.theme)
  if (!theme) return NextResponse.json({ error: 'Invalid theme values.' }, { status: 400 })

  const latest = await loadLatest(project.id)
  if (!latest) return NextResponse.json({ error: 'No generated store found.' }, { status: 404 })
  const source = latest.files?.[CONFIG_FILE]
  if (typeof source !== 'string') {
    return NextResponse.json({ error: 'This store has no data/config.ts — change the theme through the chat instead.' }, { status: 409 })
  }
  const current = readTheme(source)
  if (current && JSON.stringify(current) === JSON.stringify(theme)) {
    return NextResponse.json({ ok: true, unchanged: true, versionId: latest.id, versionNo: latest.version_no })
  }
  const updated = writeTheme(source, theme)
  if (!updated) {
    return NextResponse.json({ error: "This store's config can't be edited by the theme panel — change the theme through the chat instead." }, { status: 409 })
  }
  // Same safety filter every stored AI file passes.
  const filtered = filterAiStoreFiles({ [CONFIG_FILE]: updated })
  if (!filtered.files[CONFIG_FILE]) {
    return NextResponse.json({ error: 'The updated config failed the store safety checks.' }, { status: 422 })
  }

  const { data: version, error } = await supabaseAdmin
    .from('code_versions')
    .insert({
      project_id: project.id,
      user_id: userId,
      version_no: (latest.version_no ?? 0) + 1,
      files: { ...latest.files, [CONFIG_FILE]: updated },
      prompt: 'Theme edit (colors, fonts, radius)',
    })
    .select('id, version_no')
    .single()
  if (error || !version) {
    console.error('[theme PUT]', error)
    // Two saves raced for the same version_no — the client retries with the latest.
    const conflict = error?.code === '23505'
    return NextResponse.json({ error: conflict ? 'The store changed meanwhile — try again.' : 'Failed to save the theme.' }, { status: conflict ? 409 : 500 })
  }

  await supabaseAdmin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', project.id)
  return NextResponse.json({ ok: true, versionId: version.id, versionNo: version.version_no })
}

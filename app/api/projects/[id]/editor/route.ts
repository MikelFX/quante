// Visual editor (v1 2026-09-26, v2 2026-09-27): POST { action } for the Studio's visual
// editing mode.
//   start      → starts / reuses the project's editing sandbox (lib/editor/sandbox.ts)
//                with the latest code version instrumented; { url, nodes, versionId }
//   edit       → { oid, tag, op, baseVersionId }: text / classes / move / insert (palette
//                block) / delete, applied to the clean source (lib/editor/oid.ts), saved
//                as a DRAFT code version, hot-reloaded; { nodes, selectOid, versionId }
//   ai         → { oid, tag, mode: after|inside|replace, instruction, baseVersionId }:
//                the model writes a validated snippet (lib/editor/ai.ts); 1 credit,
//                refunded on failure; then saved like an edit
//   heartbeat  → keeps the sandbox alive while the editor is open
//   stop       → stops and deletes the sandbox
// Edits land in code_versions like any other change, so the AI sees them on the next
// chat edit and they reach shoppers only through Publish. Consecutive visual edits
// update one "Visual edits" version in place while it has never been built.

import { randomUUID } from 'node:crypto'
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { rateLimit } from '@/lib/rate-limit'
import { filterAiStoreFiles } from '@/lib/store-template/build'
import { applyEditorOp, elementSource, instrumentFiles, type EditorNode, type EditorOp } from '@/lib/editor/oid'
import { generateEditorSnippet } from '@/lib/editor/ai'
import { debitCredits, refundDebit } from '@/lib/credits'
import { isAgencyUser } from '@/lib/tier'
import { CREDIT_COSTS } from '@/lib/config'
import { cleanStoreFiles, prepareEditorFiles, reinstrument } from '@/lib/editor/files'
import {
  EDITOR_MAX_SESSIONS_PER_USER,
  EditorUnavailableError,
  heartbeatEditorSession,
  otherActiveSessions,
  startEditorSession,
  stopEditorSession,
  writeEditorFiles,
} from '@/lib/editor/sandbox'
import { platformApiUrl } from '@/lib/hosting/store-env'
import type { CodeVersionFiles } from '@/types/store-code'

export const maxDuration = 120

interface Params { params: Promise<{ id: string }> }

const VISUAL_EDIT_PROMPT = 'Visual edits'
// 'Create with AI' costs the same as a chat edit.
const AI_COST = CREDIT_COSTS.iterate

interface VersionRow { id: string; version_no: number; files: CodeVersionFiles; prompt: string | null }

async function loadLatest(projectId: string): Promise<VersionRow | null> {
  const { data } = await supabaseAdmin
    .from('code_versions')
    .select('id, version_no, files, prompt')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as VersionRow | null) ?? null
}

/** Origins the in-preview bridge may talk to: the platform URL + the Studio's own origin when it is ours. */
function bridgeOrigins(request: Request): string[] {
  const origins: string[] = []
  const platform = platformApiUrl()
  if (platform) origins.push(platform)
  const origin = request.headers.get('origin')
  if (origin && (/^https:\/\/([a-z0-9-]+\.)?quantecode\.com$/.test(origin) || (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin)))) {
    origins.push(origin)
  }
  return origins
}

function parseOp(raw: unknown): EditorOp | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { kind?: unknown; value?: unknown; direction?: unknown }
  if ((o.kind === 'text' || o.kind === 'classes') && typeof o.value === 'string') return { kind: o.kind, value: o.value }
  if (o.kind === 'move' && (o.direction === 'up' || o.direction === 'down')) return { kind: 'move', direction: o.direction }
  // Ready-made blocks from the Studio palette — validated like AI snippets (lib/editor/snippet.ts).
  const r = raw as { position?: unknown; snippet?: unknown }
  if (o.kind === 'insert' && (r.position === 'after' || r.position === 'inside') && typeof r.snippet === 'string') return { kind: 'insert', position: r.position, snippet: r.snippet }
  if (o.kind === 'delete') return { kind: 'delete' }
  return null
}

function unavailable(err: unknown) {
  if (err instanceof EditorUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 })
  console.error('[editor]', err)
  const msg = err instanceof Error && err.message.startsWith('The store failed to compile') ? err.message : 'The visual editor could not start. Please try again.'
  return NextResponse.json({ error: msg }, { status: 500 })
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const project = await getOwnedProject<{ id: string }>(id, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const action = body?.action

  if (action === 'heartbeat') {
    try {
      return NextResponse.json(await heartbeatEditorSession(project.id))
    } catch (err) {
      return unavailable(err)
    }
  }

  if (action === 'stop') {
    try {
      await stopEditorSession(project.id)
      return NextResponse.json({ ok: true })
    } catch (err) {
      return unavailable(err)
    }
  }

  if (action === 'start') {
    if (!rateLimit(`editor-start:${userId}`, 8, 60 * 60 * 1000).allowed) {
      return NextResponse.json({ error: 'Too many editor sessions started — try again later.' }, { status: 429 })
    }
    const latest = await loadLatest(project.id)
    if (!latest) return NextResponse.json({ error: 'No generated store found.' }, { status: 404 })
    try {
      if ((await otherActiveSessions(userId, project.id)) >= EDITOR_MAX_SESSIONS_PER_USER) {
        return NextResponse.json({ error: `You already have ${EDITOR_MAX_SESSIONS_PER_USER} stores open in the visual editor. Close one first.` }, { status: 429 })
      }
      const prepared = prepareEditorFiles(latest.files, bridgeOrigins(request))
      const session = await startEditorSession({ projectId: project.id, userId, files: prepared.files })
      return NextResponse.json({ url: session.url, reused: session.reused, nodes: prepared.nodes, versionId: latest.id, versionNo: latest.version_no })
    } catch (err) {
      return unavailable(err)
    }
  }

  if (action === 'edit' || action === 'ai') {
    if (!rateLimit(`editor-edit:${userId}`, 240, 10 * 60 * 1000).allowed) {
      return NextResponse.json({ error: 'Too many edits — slow down a little.' }, { status: 429 })
    }
    const oid = typeof body?.oid === 'string' ? body.oid : ''
    const tag = typeof body?.tag === 'string' ? body.tag : ''
    if (!/^[0-9a-z]+\.[0-9a-z]+$/.test(oid) || !tag) return NextResponse.json({ error: 'Invalid edit.' }, { status: 400 })

    const latest = await loadLatest(project.id)
    if (!latest) return NextResponse.json({ error: 'No generated store found.' }, { status: 404 })
    if (body?.baseVersionId !== latest.id) {
      return NextResponse.json({ error: 'The store changed (e.g. a chat edit) — the editor will reload.', code: 'stale' }, { status: 409 })
    }
    const { text } = cleanStoreFiles(latest.files)
    const current = instrumentFiles(text).nodes[oid] ?? null
    if (!current || current.tag !== tag) {
      return NextResponse.json({ error: 'That element changed meanwhile — the editor will reload.', code: 'stale' }, { status: 409 })
    }

    let op: EditorOp | null
    let refund: (() => Promise<unknown>) | null = null
    if (action === 'ai') {
      const mode = body?.mode
      const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : ''
      if (mode !== 'after' && mode !== 'inside' && mode !== 'replace') return NextResponse.json({ error: 'Invalid mode.' }, { status: 400 })
      if (instruction.length < 3 || instruction.length > 1000) return NextResponse.json({ error: 'Describe what to create (3–1000 characters).' }, { status: 400 })
      if (mode === 'replace' && !current.static) return NextResponse.json({ error: 'This element shows live data (products, prices …) — rewrite it in Chat instead.' }, { status: 422 })
      if (mode === 'inside' && !current.canInsertInside) return NextResponse.json({ error: "This element can't contain other elements." }, { status: 422 })
      if (mode === 'after' && !current.canDelete) return NextResponse.json({ error: 'Nothing can be added next to this element — add it inside instead.' }, { status: 422 })
      if (!rateLimit(`editor-ai:${userId}`, 30, 10 * 60 * 1000).allowed) {
        return NextResponse.json({ error: 'Too many AI requests — try again in a few minutes.' }, { status: 429 })
      }

      // Same price as a chat edit; debited before the model call, refunded on any failure.
      if (!(await isAgencyUser(userId))) {
        const ref = randomUUID()
        const debit = await debitCredits(userId, AI_COST, 'editor_ai', ref)
        if (!debit.ok) {
          const status = debit.error === 'insufficient_credits' || debit.error === 'billing_hold' ? 402 : 500
          const msg = debit.error === 'insufficient_credits' ? 'Not enough credits.' : debit.error === 'billing_hold' ? 'Your account is on hold after a payment dispute — contact support.' : 'Failed to debit credit.'
          return NextResponse.json({ error: msg }, { status })
        }
        refund = () => refundDebit(userId, ref, 'editor_ai', 'editor_ai_refund')
      }
      try {
        const gen = await generateEditorSnippet({
          mode,
          instruction,
          elementSource: elementSource(current.file, text[current.file], current.index) ?? '',
          fileSource: text[current.file],
        })
        if (!gen.ok) { await refund?.(); return NextResponse.json({ error: gen.error }, { status: 422 }) }
        op = mode === 'replace' ? { kind: 'replace', snippet: gen.snippet } : { kind: 'insert', position: mode, snippet: gen.snippet }
      } catch (err) {
        console.error('[editor] AI snippet failed:', err)
        await refund?.()
        return NextResponse.json({ error: 'The AI could not create the element — your credit was refunded.' }, { status: 502 })
      }
    } else {
      op = parseOp(body?.op)
      if (!op) return NextResponse.json({ error: 'Invalid edit.' }, { status: 400 })
    }

    const saved = await applyAndSave({ projectId: project.id, userId, latest, text, current, op })
    if (!saved.ok) { await refund?.(); return saved.res }
    return NextResponse.json(saved.payload)
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}

/** Applies one op to the clean source, saves the draft version, hot-reloads the sandbox. */
async function applyAndSave(opts: {
  projectId: string
  userId: string
  latest: VersionRow
  text: Record<string, string>
  current: EditorNode
  op: EditorOp
}): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; res: NextResponse }> {
  const { projectId, userId, latest, text, current, op } = opts
  const result = applyEditorOp(current.file, text[current.file], current.index, current.tag, op)
  if (!result.ok) return { ok: false, res: NextResponse.json({ error: result.error }, { status: 422 }) }

  // Same safety filter every stored AI file passes.
  const filtered = filterAiStoreFiles({ [current.file]: result.code })
  if (!filtered.files[current.file]) {
    const why = filtered.dropped[0]?.reason ?? 'safety check'
    return { ok: false, res: NextResponse.json({ error: `This edit can't be saved (${why}).` }, { status: 422 }) }
  }

  const files: CodeVersionFiles = { ...latest.files, [current.file]: result.code }
  let versionId = latest.id
  let versionNo = latest.version_no
  const { count: builds } = await supabaseAdmin
    .from('deployments').select('id', { count: 'exact', head: true }).eq('code_version_id', latest.id)
  if (latest.prompt === VISUAL_EDIT_PROMPT && (builds ?? 0) === 0) {
    const { error } = await supabaseAdmin.from('code_versions').update({ files }).eq('id', latest.id)
    if (error) return { ok: false, res: NextResponse.json({ error: 'Failed to save the edit.' }, { status: 500 }) }
  } else {
    const { data: row, error } = await supabaseAdmin
      .from('code_versions')
      .insert({ project_id: projectId, user_id: userId, version_no: latest.version_no + 1, files, prompt: VISUAL_EDIT_PROMPT })
      .select('id, version_no')
      .single()
    if (error || !row) {
      const conflict = error?.code === '23505'
      return { ok: false, res: NextResponse.json({ error: conflict ? 'The store changed meanwhile — the editor will reload.' : 'Failed to save the edit.', code: conflict ? 'stale' : undefined }, { status: conflict ? 409 : 500 }) }
    }
    versionId = row.id as string
    versionNo = row.version_no as number
  }
  await supabaseAdmin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId)

  text[current.file] = result.code
  const re = reinstrument(text, current.file)
  let sessionLost = false
  try {
    sessionLost = !(await writeEditorFiles(projectId, [re.file]))
  } catch (err) {
    console.warn('[editor] sandbox write failed:', err)
    sessionLost = true
  }
  return {
    ok: true,
    payload: {
      versionId,
      versionNo,
      nodes: re.nodes,
      selectOid: result.index >= 0 ? `${re.key}.${result.index.toString(36)}` : null,
      sessionLost,
    },
  }
}

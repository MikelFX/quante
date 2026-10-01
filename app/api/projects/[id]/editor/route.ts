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
//   ai_edit    → { oid, tag, instruction, path, baseVersionId }: "Ask Quante" about the clicked
//                element — a real code edit (element, its file or data files), safety-
//                filtered, compile-checked in the sandbox, then saved; 1 credit, refunded
//                on any failure
//   save_block → { oid, tag, name, baseVersionId }: saves the selected (static) element to
//                the user's "My elements" (lib/editor/blocks.ts); inserting one later is
//                an ordinary 'edit' insert op, validated again
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
import { applyEditorOp, editorFileKeys, elementRange, elementSource, instrumentFiles, parsesCleanly, type EditorNode, type EditorOp } from '@/lib/editor/oid'
import { indentSnippet } from '@/lib/editor/snippet'
import { withTokenClasses } from '@/lib/store-template/style-codemod'
import { editElementWithAi, generateEditorSnippet } from '@/lib/editor/ai'
import { BlocksUnavailableError, normalizeBlockName, saveBlock } from '@/lib/editor/blocks'
import { debitCredits, refundDebit } from '@/lib/credits'
import { isAgencyUser } from '@/lib/tier'
import { CREDIT_COSTS } from '@/lib/config'
import { cleanStoreFiles, prepareEditorFiles, reinstrument } from '@/lib/editor/files'
import {
  EDITOR_MAX_SESSIONS_PER_USER,
  EditorUnavailableError,
  checkEditorPage,
  type SandboxFile,
  heartbeatEditorSession,
  otherActiveSessions,
  startEditorSession,
  stopEditorSession,
  writeEditorFiles,
} from '@/lib/editor/sandbox'
import { platformApiUrl } from '@/lib/hosting/store-env'
import type { CodeVersionFiles } from '@/types/store-code'

export const maxDuration = 300

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

  if (action === 'ai_edit') {
    if (!rateLimit(`editor-ai:${userId}`, 30, 10 * 60 * 1000).allowed) {
      return NextResponse.json({ error: 'Too many AI requests — try again in a few minutes.' }, { status: 429 })
    }
    const oid = typeof body?.oid === 'string' ? body.oid : ''
    const tag = typeof body?.tag === 'string' ? body.tag : ''
    const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : ''
    const path = typeof body?.path === 'string' && body.path.length <= 300 ? body.path : '/'
    if (!/^[0-9a-z]+\.[0-9a-z]+$/.test(oid) || !tag) return NextResponse.json({ error: 'Invalid element.' }, { status: 400 })
    if (instruction.length < 2 || instruction.length > 2000) return NextResponse.json({ error: 'Tell Quante what to change (up to 2000 characters).' }, { status: 400 })
    const latest = await loadLatest(project.id)
    if (!latest) return NextResponse.json({ error: 'No generated store found.' }, { status: 404 })
    if (body?.baseVersionId !== latest.id) {
      return NextResponse.json({ error: 'The store changed (e.g. a chat edit) — the editor will reload.', code: 'stale' }, { status: 409 })
    }
    return handleAiEdit({ projectId: project.id, userId, latest, oid, tag, instruction, path })
  }

  if (action === 'save_block') {
    if (!rateLimit(`editor-save-block:${userId}`, 30, 10 * 60 * 1000).allowed) {
      return NextResponse.json({ error: 'Too many saves — try again in a few minutes.' }, { status: 429 })
    }
    const oid = typeof body?.oid === 'string' ? body.oid : ''
    const tag = typeof body?.tag === 'string' ? body.tag : ''
    const name = normalizeBlockName(body?.name)
    if (!/^[0-9a-z]+\.[0-9a-z]+$/.test(oid) || !tag) return NextResponse.json({ error: 'Invalid element.' }, { status: 400 })
    if (!name) return NextResponse.json({ error: 'Give the element a name.' }, { status: 400 })
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
    const source = elementSource(current.file, text[current.file], current.index)
    if (!source) return NextResponse.json({ error: 'That element could not be read.' }, { status: 422 })
    try {
      const saved = await saveBlock(userId, name, source)
      if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status })
      return NextResponse.json({ block: saved.block })
    } catch (err) {
      if (err instanceof BlocksUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 })
      console.error('[editor] save block failed:', err)
      return NextResponse.json({ error: 'Failed to save the element.' }, { status: 500 })
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

/**
 * Saves files as the draft "Visual edits" version: updated in place while that version
 * has never been built, otherwise a new version.
 */
async function saveDraft(projectId: string, userId: string, latest: VersionRow, files: CodeVersionFiles): Promise<{ ok: true; versionId: string; versionNo: number } | { ok: false; res: NextResponse }> {
  const { count: builds } = await supabaseAdmin
    .from('deployments').select('id', { count: 'exact', head: true }).eq('code_version_id', latest.id)
  let versionId = latest.id
  let versionNo = latest.version_no
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
  return { ok: true, versionId, versionNo }
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

  const saved = await saveDraft(projectId, userId, latest, { ...latest.files, [current.file]: result.code })
  if (!saved.ok) return saved
  const { versionId, versionNo } = saved

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

// Paths "Ask Quante" may write besides the element's own file: the data files it was shown
// (passed in `context`) and NEW components.
const NEW_COMPONENT_RE = /^components\/store\/[A-Za-z0-9_-]+\.tsx$/
const DATA_CONTEXT_FILES = ['data/config.ts', 'data/products.ts']
const MAX_CONTEXT_CHARS = 60_000

/**
 * "Ask Quante" on a clicked element: the model edits the element (or its file / the data
 * files), the result passes the store-file safety filter, is written into the sandbox and
 * must compile there — otherwise it is reverted and the credit refunded. Only then is it
 * saved as the draft version.
 */
async function handleAiEdit(opts: {
  projectId: string
  userId: string
  latest: VersionRow
  oid: string
  tag: string
  instruction: string
  path: string
}): Promise<NextResponse> {
  const { projectId, userId, latest, oid, tag, instruction, path } = opts
  const { text } = cleanStoreFiles(latest.files)
  const before = instrumentFiles(text)
  const current = before.nodes[oid] ?? null
  if (!current || current.tag !== tag) {
    return NextResponse.json({ error: 'That element changed meanwhile — the editor will reload.', code: 'stale' }, { status: 409 })
  }
  const source = text[current.file]
  const range = elementRange(current.file, source, current.index)
  if (!range) return NextResponse.json({ error: 'That element could not be read.' }, { status: 422 })

  let refund: (() => Promise<unknown>) | null = null
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
  const fail = async (error: string, status = 422, code?: string) => {
    await refund?.()
    return NextResponse.json({ error: refund ? `${error} Your credit was refunded.` : error, code }, { status })
  }

  const context: Record<string, string> = {}
  for (const p of DATA_CONTEXT_FILES) {
    if (p !== current.file && text[p] && text[p].length <= MAX_CONTEXT_CHARS) context[p] = text[p]
  }
  const lineOf = (offset: number) => source.slice(0, offset).split('\n').length

  let gen: Awaited<ReturnType<typeof editElementWithAi>>
  try {
    gen = await editElementWithAi({
      instruction,
      filePath: current.file,
      fileSource: source,
      elementSource: source.slice(range.start, range.end),
      startLine: lineOf(range.start),
      endLine: lineOf(range.end),
      context,
      allPaths: Object.keys(text),
    })
  } catch (err) {
    console.error('[editor] ai_edit failed:', err)
    return fail('Quante could not finish the change.', 502)
  }
  if (!gen.ok) return fail(gen.error)

  // Assemble the changed files (allowed paths only).
  const changed: Record<string, string> = {}
  if (gen.element && !(current.file in gen.files)) {
    const lineStart = source.lastIndexOf('\n', range.start - 1) + 1
    const indent = source.slice(lineStart, range.start).match(/^\s*/)?.[0] ?? ''
    changed[current.file] = source.slice(0, range.start) + indentSnippet(gen.element, indent) + source.slice(range.end)
  }
  for (const [p, content] of Object.entries(gen.files)) {
    if (p === current.file || p in context || (!(p in text) && NEW_COMPONENT_RE.test(p))) changed[p] = content
    else console.warn('[editor] ai_edit ignored a file it may not write:', p)
  }
  for (const [p, content] of Object.entries(changed)) {
    if (content === text[p]) delete changed[p]
    else if (!parsesCleanly(p, content)) return fail('Quante made a syntax error, so nothing was changed.')
  }
  if (Object.keys(changed).length === 0) {
    // Nothing to apply (e.g. the request was impossible here) — the reply explains why.
    await refund?.()
    return NextResponse.json({ reply: gen.reply, unchanged: true })
  }

  const filtered = filterAiStoreFiles(withTokenClasses(changed))
  if (Object.keys(filtered.files).length === 0) {
    return fail(`The change failed the store safety checks (${filtered.dropped.map((d) => d.reason).join('; ') || 'safety check'}).`)
  }
  const warning = filtered.dropped.length > 0
    ? `Part of the change was not applied (${filtered.dropped.map((d) => d.path).join(', ')} failed the safety checks).`
    : null

  // Write into the sandbox — every file whose instrumented copy changed (a new file shifts
  // the oid keys of the others) — and make sure the page still compiles.
  const nextText = { ...text, ...filtered.files }
  const after = instrumentFiles(nextText)
  const writes: SandboxFile[] = []
  const reverts: SandboxFile[] = []
  for (const p of Object.keys(nextText)) {
    const now = after.files[p] ?? nextText[p]
    const was = p in text ? (before.files[p] ?? text[p]) : null
    if (now === was) continue
    writes.push({ path: p, content: now })
    if (was !== null) reverts.push({ path: p, content: was })
  }
  let written = false
  try {
    written = await writeEditorFiles(projectId, writes)
  } catch (err) {
    console.warn('[editor] ai_edit sandbox write failed:', err)
  }
  if (!written) return fail('The editor session ended — it will restart; then try again.', 409, 'stale')
  const check = await checkEditorPage(projectId, path)
  if (!check.ok) {
    console.warn('[editor] ai_edit did not compile, reverting:', check.log)
    await writeEditorFiles(projectId, reverts).catch(() => false)
    return fail("Quante's change didn't compile, so it was undone. Try describing it differently.")
  }

  const merged = filterAiStoreFiles({ ...latest.files, ...filtered.files })
  const saved = await saveDraft(projectId, userId, latest, merged.files)
  if (!saved.ok) {
    await writeEditorFiles(projectId, reverts).catch(() => false)
    await refund?.()
    return saved.res
  }

  const newKey = editorFileKeys(Object.keys(nextText)).get(current.file)
  const candidate = newKey !== undefined ? `${newKey}.${current.index.toString(36)}` : null
  return NextResponse.json({
    versionId: saved.versionId,
    versionNo: saved.versionNo,
    nodes: after.nodes,
    selectOid: candidate && after.nodes[candidate]?.tag === current.tag ? candidate : null,
    reply: gen.reply,
    warning,
    sessionLost: false,
  })
}

import 'server-only'

// Visual editor v3 — "My elements" (2026-09-27): a merchant's saved, reusable elements
// (table editor_blocks, supabase/migration-editor-blocks.sql). Per user, usable in every
// store they own. A block is only a validated static snippet (lib/editor/snippet.ts) —
// inserting one goes through the normal editor 'edit' path, which validates it again.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { indentSnippet, validateSnippet } from '@/lib/editor/snippet'

export const MAX_BLOCKS_PER_USER = 100
const MAX_NAME_CHARS = 60

export interface EditorBlock {
  id: string
  name: string
  snippet: string
  created_at: string
}

export class BlocksUnavailableError extends Error {
  constructor() {
    super('Saving elements is not set up yet (database migration pending).')
  }
}

function missingTable(error: { code?: string } | null): boolean {
  // 42P01 = undefined_table; PGRST205 = table not in PostgREST's schema cache.
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

export function normalizeBlockName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_CHARS)
  return name || null
}

/** The user's blocks, newest first; null when the table does not exist yet. */
export async function listBlocks(userId: string): Promise<EditorBlock[] | null> {
  const { data, error } = await supabaseAdmin
    .from('editor_blocks')
    .select('id, name, snippet, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_BLOCKS_PER_USER)
  if (missingTable(error)) return null
  if (error) throw new Error(error.message)
  return (data ?? []) as EditorBlock[]
}

export type SaveBlockResult = { ok: true; block: EditorBlock } | { ok: false; error: string; status: number }

/** Validates an element's source as a static snippet and stores it (dedented). */
export async function saveBlock(userId: string, name: string, source: string): Promise<SaveBlockResult> {
  const v = validateSnippet(source)
  if (!v.ok) {
    return { ok: false, status: 422, error: `Only plain elements can be saved — this one contains code or live data (${v.error})` }
  }
  const { count, error: countErr } = await supabaseAdmin
    .from('editor_blocks').select('id', { count: 'exact', head: true }).eq('user_id', userId)
  if (missingTable(countErr)) throw new BlocksUnavailableError()
  if (countErr) throw new Error(countErr.message)
  if ((count ?? 0) >= MAX_BLOCKS_PER_USER) {
    return { ok: false, status: 409, error: `You can keep up to ${MAX_BLOCKS_PER_USER} saved elements — delete some first.` }
  }
  const { data, error } = await supabaseAdmin
    .from('editor_blocks')
    .insert({ user_id: userId, name, snippet: indentSnippet(v.code, '') })
    .select('id, name, snippet, created_at')
    .single()
  if (missingTable(error)) throw new BlocksUnavailableError()
  if (error || !data) throw new Error(error?.message ?? 'insert failed')
  return { ok: true, block: data as EditorBlock }
}

/** Deletes one of the user's blocks; false when it does not exist (or is not theirs). */
export async function deleteBlock(userId: string, id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('editor_blocks').delete().eq('id', id).eq('user_id', userId).select('id')
  if (missingTable(error)) throw new BlocksUnavailableError()
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

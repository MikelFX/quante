// Visual editor "My elements" (2026-09-27).
//   GET                → { blocks, available } — the caller's saved elements, newest first
//   DELETE ?id=<uuid>  → deletes one of the caller's saved elements
// Saving happens in the editor ('save_block' action of /api/projects/[id]/editor), which
// reads the selected element's source from the store; inserting uses the normal 'edit'
// insert op, so every block is validated again whenever it is used.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { BlocksUnavailableError, deleteBlock, listBlocks } from '@/lib/editor/blocks'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const blocks = await listBlocks(userId)
    return NextResponse.json({ blocks: blocks ?? [], available: blocks !== null })
  } catch (err) {
    console.error('[editor-blocks] list failed:', err)
    return NextResponse.json({ error: 'Failed to load your elements.' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 })
  try {
    if (!(await deleteBlock(userId, id))) return NextResponse.json({ error: 'Element not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof BlocksUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 })
    console.error('[editor-blocks] delete failed:', err)
    return NextResponse.json({ error: 'Failed to delete the element.' }, { status: 500 })
  }
}

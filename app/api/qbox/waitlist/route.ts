// POST /api/qbox/waitlist — "request access" to the Qbox closed beta. Signed-in only, free.
// The operator invites from qbox_waitlist by adding a qbox_beta row (supabase/migration-qbox-beta.sql).

import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { isMissingTable } from '@/lib/qbox/store'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  if (!rateLimit(`qbox:wait:${userId}`, 5, 60_000).allowed) return NextResponse.json({ error: 'Try again in a minute.' }, { status: 429 })
  const body = await request.json().catch(() => ({}))
  const useCase = typeof body?.useCase === 'string' ? body.useCase.trim().slice(0, 1000) : null
  const user = await currentUser().catch(() => null)
  const email = user?.primaryEmailAddress?.emailAddress ?? null
  const { error } = await supabaseAdmin.from('qbox_waitlist')
    .upsert({ user_id: userId, email, use_case: useCase || null }, { onConflict: 'user_id' })
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: 'The beta is not set up yet.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not save the request.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// GET /api/cron/qgent-cleanup — daily Vercel cron (vercel.json). Deletes public Qgent chats
// past their 30-day retention (qgent_public_sessions.expires_at) and usage rows older than a
// year. Fails closed without CRON_SECRET (lib/cron-auth.ts).

import { NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sessions = await supabaseAdmin
    .from('qgent_public_sessions')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString())
  if (sessions.error) {
    console.error('[qgent-cleanup] sessions:', sessions.error.code, sessions.error.message)
    return NextResponse.json({ error: sessions.error.message }, { status: 500 })
  }

  const yearAgo = new Date(Date.now() - 366 * 24 * 3600_000).toISOString().slice(0, 7)
  const usage = await supabaseAdmin.from('qgent_public_usage').delete({ count: 'exact' }).lt('month', yearAgo)
  if (usage.error) console.error('[qgent-cleanup] usage:', usage.error.code, usage.error.message)

  return NextResponse.json({ deletedSessions: sessions.count ?? 0, deletedMonths: usage.count ?? 0 })
}

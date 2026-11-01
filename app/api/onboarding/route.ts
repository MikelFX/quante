// POST /api/onboarding — the /start wizard's answers (who you are, what you want first) saved on the
// profile, so the wizard is not shown again. Free, owner-only (the signed-in account), no model call.
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { DONE_COOKIE, parseAnswers, toSaved } from '@/lib/onboarding/model'
import { writeSaved } from '@/lib/onboarding/server'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`onboarding:${userId}`, 20, 3_600_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const answers = parseAnswers(body)
  const skipped = body?.skipped === true
  if (!skipped && (!answers.persona || !answers.goal)) {
    return NextResponse.json({ error: 'Pick who you are and what you want to do.' }, { status: 400 })
  }

  try {
    await writeSaved(userId, toSaved(answers, skipped), answers.goal === 'ads' ? answers.adKind : null)
  } catch (e) {
    console.error('[onboarding] save failed:', e instanceof Error ? e.message : e)
    // Not fatal for the visitor: the wizard still takes them on; the cookie keeps the dashboard quiet.
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(DONE_COOKIE, '1', { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', secure: true, httpOnly: true })
  return res
}

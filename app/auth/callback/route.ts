import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CREDIT_COSTS } from '@/lib/config'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && user) {
      // Welcome grant for brand-new users. Amount is CREDIT_COSTS.welcome_grant
      // so the marketing site + the debit here can never disagree.
      // Idempotent — a returning user already has ledger rows, so count > 0
      // and the insert is skipped.
      const { count } = await supabase
        .from('credit_ledger')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)

      if (!count) {
        const grant = CREDIT_COSTS.welcome_grant
        await supabase.from('credit_ledger').insert({
          user_id: user.id,
          delta: grant,
          reason: 'welcome_grant',
          ref_id: null,
          balance_after: grant,
        })
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && user) {
      // Grant 25 welcome credits to brand-new users (idempotent)
      const { count } = await supabase
        .from('credit_ledger')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)

      if (!count) {
        await supabase.from('credit_ledger').insert({
          user_id: user.id,
          delta: 25,
          reason: 'welcome_grant',
          ref_id: null,
          balance_after: 25,
        })
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}

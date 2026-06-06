import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const WELCOME_CREDITS = 25

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()

  const { data } = await supabase
    .from('credit_ledger').select('balance_after')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (!data) {
    await supabase.from('credit_ledger').insert({
      user_id: userId, delta: WELCOME_CREDITS, reason: 'welcome_grant', ref_id: null, balance_after: WELCOME_CREDITS,
    })
    return NextResponse.json({ balance: WELCOME_CREDITS })
  }

  return NextResponse.json({ balance: data.balance_after })
}

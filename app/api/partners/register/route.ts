// POST /api/partners/register
// Self-serve partner (reseller/agency) registration. Creates a `partners` row with
// status 'pending' — an admin must approve it (see /api/admin/partners/[id]/status)
// before it can earn commission. One partner account per Quante user.

import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

function generateReferralCode(): string {
  // 8 uppercase alphanumeric chars, no ambiguous 0/O/1/I — human-shareable in a link.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
  return code
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : ''
  const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() : ''

  if (!companyName || !contactEmail) {
    return Response.json({ error: 'companyName and contactEmail are required' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return Response.json({ error: 'contactEmail is not a valid email address' }, { status: 400 })
  }

  const { data: existing } = await supabaseAdmin
    .from('partners')
    .select('id, status, referral_code')
    .eq('user_id', userId)
    .maybeSingle()
  if (existing) return Response.json({ error: 'You already have a partner account', partner: existing }, { status: 409 })

  // Insert-first with a retry loop on referral_code collisions (23505) rather than
  // pre-checking uniqueness — same convention used for other unique-generated codes
  // in this codebase (e.g. store order numbers).
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabaseAdmin
      .from('partners')
      .insert({
        user_id: userId,
        company_name: companyName,
        contact_email: contactEmail,
        referral_code: generateReferralCode(),
      })
      .select('id, company_name, contact_email, referral_code, commission_rate_bps, status, created_at')
      .single()

    if (!error) return Response.json({ partner: data }, { status: 201 })

    const code = (error as { code?: string }).code
    if (code === '23505' && error.message.includes('referral_code')) continue // regenerate and retry
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ error: 'Could not generate a unique referral code, try again' }, { status: 500 })
}

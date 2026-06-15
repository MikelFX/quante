// POST /api/quante/image-suggest
// Uses Claude to build an optimal Unsplash search query for a product,
// then fetches a grid of high-quality images the merchant can choose from.
// Costs 1 credit.

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, ITERATION_MODEL } from '@/lib/claude'
import { NextResponse } from 'next/server'

const SUGGEST_COST = 1

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY
  if (!UNSPLASH_KEY) {
    return NextResponse.json({ error: 'Image suggestions require UNSPLASH_ACCESS_KEY to be configured.' }, { status: 503 })
  }

  let body: { productName: string; productDescription?: string; projectId?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { productName, productDescription = '', projectId } = body
  if (!productName) return NextResponse.json({ error: 'productName required' }, { status: 400 })

  // Check + debit credits
  const supabase = await createClient()
  const { data: lastEntry } = await supabase
    .from('credit_ledger')
    .select('balance_after')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const balance = lastEntry?.balance_after ?? 0
  if (balance < SUGGEST_COST) {
    return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 })
  }

  const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin
    .from('credit_ledger')
    .insert({
      user_id: userId,
      delta: -SUGGEST_COST,
      reason: 'image_suggest',
      ref_id: projectId ?? null,
      balance_after: balance - SUGGEST_COST,
    })
    .select()
    .single()

  if (ledgerErr || !ledgerRow) {
    return NextResponse.json({ error: 'Failed to debit credit' }, { status: 500 })
  }

  try {
    // Ask Claude for the best Unsplash search query
    const msg = await anthropic.messages.create({
      model: ITERATION_MODEL,
      max_tokens: 128,
      messages: [{
        role: 'user',
        content: `Generate the best Unsplash photo search query for this e-commerce product.

Product: ${productName}
${productDescription ? `Description: ${productDescription}` : ''}

Return ONLY a single concise search query (3-6 words), no explanation, no quotes.
Good examples: "ceramic coffee mug white", "leather wallet flat lay", "skincare serum bottle".`,
      }],
    })

    const query = msg.content[0].type === 'text'
      ? msg.content[0].text.trim().replace(/^["']|["']$/g, '')
      : productName

    // Fetch from Unsplash
    const unsplashRes = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=12&orientation=squarish`,
      { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }
    )

    if (!unsplashRes.ok) {
      // Refund on Unsplash failure
      await supabaseAdmin.from('credit_ledger').insert({
        user_id: userId, delta: SUGGEST_COST, reason: 'image_suggest_refund',
        ref_id: ledgerRow.id, balance_after: balance,
      })
      return NextResponse.json({ error: 'Image service unavailable' }, { status: 502 })
    }

    const unsplashData = await unsplashRes.json()
    const images = (unsplashData.results ?? []).map((r: {
      urls: { regular: string; small: string }
      user: { name: string; links: { html: string } }
      alt_description: string
    }) => ({
      url: r.urls.regular,
      thumb: r.urls.small,
      alt: r.alt_description ?? productName,
      credit: r.user.name,
      creditUrl: r.user.links.html + '?utm_source=quante&utm_medium=referral',
    }))

    return NextResponse.json({ images, query, creditsUsed: SUGGEST_COST, balanceAfter: balance - SUGGEST_COST })
  } catch (err) {
    await supabaseAdmin.from('credit_ledger').insert({
      user_id: userId, delta: SUGGEST_COST, reason: 'image_suggest_refund',
      ref_id: ledgerRow.id, balance_after: balance,
    })
    console.error('[image-suggest] error:', err)
    return NextResponse.json({ error: 'Image suggestion failed' }, { status: 500 })
  }
}

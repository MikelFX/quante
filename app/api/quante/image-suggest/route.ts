// POST /api/quante/image-suggest
// Uses Claude to build an optimal Unsplash search query for a product,
// then fetches a grid of high-quality images the merchant can choose from.
// Costs 1 credit.

import { auth } from '@clerk/nextjs/server'
import { randomUUID } from 'crypto'
import { getOwnedProject } from '@/lib/auth/project'
import { debitCredits, refundDebit } from '@/lib/credits'
import { anthropic, ITERATION_MODEL } from '@/lib/claude'
import { NextResponse } from 'next/server'

const SUGGEST_COST = 1
const MAX_NAME_CHARS = 200
const MAX_DESCRIPTION_CHARS = 1000
// debitCredits() refuses accounts flagged after a chargeback (users.billing_hold).
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY
  if (!UNSPLASH_KEY) {
    return NextResponse.json({ error: 'Image suggestions require UNSPLASH_ACCESS_KEY to be configured.' }, { status: 503 })
  }

  let body: { productName?: unknown; productDescription?: unknown; projectId?: unknown }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { projectId } = body
  // Bound the prompt size — this is a cheap 1-credit call and must stay cheap.
  const productName = typeof body.productName === 'string' ? body.productName.trim().slice(0, MAX_NAME_CHARS) : ''
  const productDescription = typeof body.productDescription === 'string'
    ? body.productDescription.trim().slice(0, MAX_DESCRIPTION_CHARS)
    : ''
  if (!productName) return NextResponse.json({ error: 'productName required' }, { status: 400 })

  // Optional project context — when given it must belong to the caller.
  if (projectId !== undefined && projectId !== null && projectId !== '') {
    const project = await getOwnedProject(projectId, userId, 'id')
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Atomic debit BEFORE the Claude/Unsplash calls; refundDebit (this request only) on failure.
  const creditRef = randomUUID()
  const debit = await debitCredits(userId, SUGGEST_COST, 'image_suggest', creditRef)
  if (!debit.ok) {
    if (debit.error === 'insufficient_credits') {
      return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 })
    }
    if (debit.error === 'billing_hold') {
      return NextResponse.json({ error: BILLING_HOLD_MESSAGE, code: 'billing_hold' }, { status: 402 })
    }
    return NextResponse.json({ error: 'Failed to debit credit' }, { status: 500 })
  }
  const refund = () => refundDebit(userId, creditRef, 'image_suggest', 'image_suggest_refund')

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

    const query = (msg.content[0]?.type === 'text'
      ? msg.content[0].text.trim().replace(/^["']|["']$/g, '')
      : productName).slice(0, 100)

    // Fetch from Unsplash
    const unsplashRes = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=12&orientation=squarish`,
      { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }
    )

    if (!unsplashRes.ok) {
      // Refund on Unsplash failure
      await refund()
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

    return NextResponse.json({ images, query, creditsUsed: SUGGEST_COST, balanceAfter: debit.balance })
  } catch (err) {
    await refund()
    console.error('[image-suggest] error:', err)
    return NextResponse.json({ error: 'Image suggestion failed' }, { status: 500 })
  }
}

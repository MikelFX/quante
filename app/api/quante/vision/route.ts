// POST /api/quante/vision
// Accepts a base64 image + optional project context, runs Claude vision to
// extract a brand palette, typography recommendation, and voice from the image.
// Returns a partial ShopManifest design patch (never writes to DB — caller applies it).

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, ITERATION_MODEL } from '@/lib/claude'
import { NextResponse } from 'next/server'

// Costs 1 credit (same as iterate)
const VISION_COST = 1

const VISION_SYSTEM = `You are an expert brand designer and color theorist.
You will receive an image and must extract a complete e-commerce brand design system from it.

YOUR ONLY OUTPUT IS VALID JSON — no prose, no markdown, no code fences.

Return exactly this shape:
{
  "palette": {
    "bg": "#hex",
    "surface": "#hex",
    "text": "#hex",
    "muted": "#hex",
    "accent": "#hex",
    "accentText": "#hex",
    "border": "#hex"
  },
  "typography": {
    "headingFont": "Google Font name",
    "bodyFont": "Google Font name",
    "scale": "compact" | "comfortable" | "spacious"
  },
  "radius": "none" | "sm" | "md" | "lg" | "full",
  "density": "tight" | "normal" | "airy",
  "motion": "none" | "subtle" | "expressive",
  "voice": "minimal" | "editorial" | "playful" | "luxury" | "technical",
  "reasoning": "2-3 sentences explaining the design choices"
}

Rules:
- Extract dominant colors from the image for the palette.
- bg and surface should be distinct (surface 8-12% lighter or darker than bg).
- text must have 7:1 contrast against bg.
- accent must stand out — use the most saturated/distinctive color in the image.
- accentText must be readable (high contrast) against accent.
- border should be subtle: bg with 10-15% opacity shift.
- For fonts: choose from Google Fonts that match the mood. Examples:
  luxury→"Cormorant Garamond"+"Jost", minimal→"DM Sans"+"DM Sans",
  editorial→"Playfair Display"+"Source Serif 4", playful→"Plus Jakarta Sans"+"Plus Jakarta Sans",
  technical→"IBM Plex Mono"+"IBM Plex Sans".
- Only return valid hex colors (#rrggbb format).`

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { imageBase64: string; mimeType?: string; projectId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { imageBase64, mimeType = 'image/jpeg', projectId } = body
  if (!imageBase64) return NextResponse.json({ error: 'imageBase64 required' }, { status: 400 })

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
  if (balance < VISION_COST) {
    return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 })
  }

  // Debit credit first (refund on failure)
  const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin
    .from('credit_ledger')
    .insert({
      user_id: userId,
      delta: -VISION_COST,
      reason: 'vision',
      ref_id: projectId ?? null,
      balance_after: balance - VISION_COST,
    })
    .select()
    .single()

  if (ledgerErr || !ledgerRow) {
    return NextResponse.json({ error: 'Failed to debit credit' }, { status: 500 })
  }

  try {
    const msg = await anthropic.messages.create({
      model: ITERATION_MODEL,
      max_tokens: 1024,
      system: VISION_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: 'Extract a complete brand design system from this image. Return only the JSON object.',
            },
          ],
        },
      ],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    // Strip code fences if model adds them despite instructions
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let vision: Record<string, unknown>
    try {
      vision = JSON.parse(cleaned)
    } catch {
      // Refund on parse failure
      await supabaseAdmin.from('credit_ledger').insert({
        user_id: userId, delta: VISION_COST, reason: 'vision_refund',
        ref_id: ledgerRow.id, balance_after: balance,
      })
      return NextResponse.json({ error: 'Vision model returned invalid JSON' }, { status: 500 })
    }

    return NextResponse.json({ vision, creditsUsed: VISION_COST, balanceAfter: balance - VISION_COST })
  } catch (err) {
    // Refund on API error
    await supabaseAdmin.from('credit_ledger').insert({
      user_id: userId, delta: VISION_COST, reason: 'vision_refund',
      ref_id: ledgerRow.id, balance_after: balance,
    })
    console.error('[vision] Claude API error:', err)
    return NextResponse.json({ error: 'Vision analysis failed' }, { status: 500 })
  }
}

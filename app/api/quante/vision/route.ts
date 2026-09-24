// POST /api/quante/vision
// Accepts a base64 image + optional project context, runs Claude vision to
// extract a brand palette, typography recommendation, and voice from the image.
// Returns a partial ShopManifest design patch (never writes to DB — caller applies it).

import { auth } from '@clerk/nextjs/server'
import { randomUUID } from 'crypto'
import { getOwnedProject } from '@/lib/auth/project'
import { debitCredits, refundDebit } from '@/lib/credits'
import { anthropic, ITERATION_MODEL } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { NextResponse } from 'next/server'

// Costs 1 credit (same as iterate)
const VISION_COST = 1
const VISION_RATE_LIMIT_PER_HOUR = 30
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
// Claude's per-image limit is 5 MB of decoded bytes ≈ 6.7M base64 chars.
const MAX_BASE64_CHARS = 7_000_000
// debitCredits() refuses accounts flagged after a chargeback (users.billing_hold).
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'

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

  let body: { imageBase64?: unknown; mimeType?: unknown; projectId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { imageBase64, mimeType = 'image/jpeg', projectId } = body
  if (typeof imageBase64 !== 'string' || !imageBase64) {
    return NextResponse.json({ error: 'imageBase64 required' }, { status: 400 })
  }
  if (typeof mimeType !== 'string' || !ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 })
  }
  if (imageBase64.length > MAX_BASE64_CHARS) {
    return NextResponse.json({ error: 'Image too large (max 5 MB)' }, { status: 413 })
  }

  // Optional project context — when given it must belong to the caller.
  if (projectId !== undefined && projectId !== null && projectId !== '') {
    const project = await getOwnedProject(projectId, userId, 'id')
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Rate limit — failures are refunded, so paid Claude calls must be bounded some other
  // way. DB-backed count of this user's vision debits (refunded ones included).
  if (!rateLimit(`vision:${userId}`, VISION_RATE_LIMIT_PER_HOUR, 3_600_000).allowed) {
    return NextResponse.json({ error: `Rate limit reached — max ${VISION_RATE_LIMIT_PER_HOUR} image analyses per hour.` }, { status: 429 })
  }
  const { count: recentCount, error: countErr } = await supabaseAdmin
    .from('credit_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('reason', 'vision')
    .lt('delta', 0)
    .gte('created_at', new Date(Date.now() - 3_600_000).toISOString())
  if (countErr || (recentCount ?? 0) >= VISION_RATE_LIMIT_PER_HOUR) {
    return NextResponse.json({ error: `Rate limit reached — max ${VISION_RATE_LIMIT_PER_HOUR} image analyses per hour.` }, { status: 429 })
  }

  // Atomic debit BEFORE the Claude call; refundDebit (this request's debit only) on failure.
  const creditRef = randomUUID()
  const debit = await debitCredits(userId, VISION_COST, 'vision', creditRef)
  if (!debit.ok) {
    if (debit.error === 'insufficient_credits') {
      return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 })
    }
    if (debit.error === 'billing_hold') {
      return NextResponse.json({ error: BILLING_HOLD_MESSAGE, code: 'billing_hold' }, { status: 402 })
    }
    return NextResponse.json({ error: 'Failed to debit credit' }, { status: 500 })
  }
  const refund = () => refundDebit(userId, creditRef, 'vision', 'vision_refund')

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

    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    // Strip code fences if model adds them despite instructions
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let vision: Record<string, unknown>
    try {
      vision = JSON.parse(cleaned)
    } catch {
      // Refund on parse failure
      await refund()
      return NextResponse.json({ error: 'Vision model returned invalid JSON' }, { status: 500 })
    }

    return NextResponse.json({ vision, creditsUsed: VISION_COST, balanceAfter: debit.balance })
  } catch (err) {
    // Refund on API error
    await refund()
    console.error('[vision] Claude API error:', err)
    return NextResponse.json({ error: 'Vision analysis failed' }, { status: 500 })
  }
}

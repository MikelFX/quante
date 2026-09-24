// POST /api/quante/custom-component
// Generates a sandboxed, validated React component from an instruction.
// The component is stored in custom_components and referenced in the manifest
// via { type: 'customComponent', ref: '<ref>' }.
// Costs 3 credits.

import { auth } from '@clerk/nextjs/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { debitCredits, refundDebit } from '@/lib/credits'
import { anthropic, ITERATION_MODEL } from '@/lib/claude'
import { validateCustomComponent } from '@/lib/sandbox/validate-component'
import { rateLimit } from '@/lib/rate-limit'
import { NextResponse } from 'next/server'

export const maxDuration = 120

const COMPONENT_COST = 3
const MAX_INSTRUCTION_CHARS = 4000
const MAX_NAME_CHARS = 120
const COMPONENT_RATE_LIMIT_PER_HOUR = 20
// debitCredits() refuses accounts flagged after a chargeback (users.billing_hold).
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'

const COMPONENT_SYSTEM = `You are an expert React developer generating isolated, sandboxed storefront components for an e-commerce platform.

RULES:
1. Output ONLY valid TypeScript React code — no prose, no code fences, just the raw TSX.
2. ONLY import from: "react" and "framer-motion". No other imports.
3. The component MUST have a default export.
4. Use design tokens via CSS variables: --s-bg, --s-surface, --s-text, --s-muted, --s-accent, --s-accent-text, --s-border, --s-font-heading, --s-font-body, --s-radius, --s-space.
5. NO network calls (no fetch, XMLHttpRequest, WebSocket).
6. NO localStorage, sessionStorage, cookies.
7. NO dangerouslySetInnerHTML.
8. NO eval, new Function, dynamic import.
9. NO process.env access.
10. Use inline styles only (no Tailwind classes, no CSS imports).
11. The component receives a \`props\` object — define a clear Props interface.
12. Must be mobile-responsive (use clamp(), min(), max(), flexWrap, or auto-fit grids).
13. Animate with framer-motion only if motion adds value.
14. Keep it under 200 lines.`

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: unknown; instruction?: unknown; name?: unknown }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { projectId } = body
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, MAX_NAME_CHARS)
    : 'Custom Component'
  if (!projectId || !instruction) {
    return NextResponse.json({ error: 'projectId and instruction are required' }, { status: 400 })
  }
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    return NextResponse.json({ error: `Instruction too long (max ${MAX_INSTRUCTION_CHARS} characters).` }, { status: 400 })
  }

  // Verify project ownership (service-role client — RLS does not apply)
  const project = await getOwnedProject<{ id: string }>(projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Rate limit. Failed generations (e.g. an instruction that forces fetch() and so fails
  // sandbox validation) are refunded in full, so without a cap a user holding 3 credits
  // could loop paid Claude calls forever. The ledger count is DB-backed (works across
  // serverless instances) and includes refunded attempts, since the debit row stays.
  if (!rateLimit(`custom-component:${userId}`, COMPONENT_RATE_LIMIT_PER_HOUR, 3_600_000).allowed) {
    return NextResponse.json({ error: `Rate limit reached — max ${COMPONENT_RATE_LIMIT_PER_HOUR} components per hour.` }, { status: 429 })
  }
  const { count: recentCount, error: countErr } = await supabaseAdmin
    .from('credit_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('reason', 'custom_component')
    .lt('delta', 0)
    .gte('created_at', new Date(Date.now() - 3_600_000).toISOString())
  if (countErr || (recentCount ?? 0) >= COMPONENT_RATE_LIMIT_PER_HOUR) {
    return NextResponse.json({ error: `Rate limit reached — max ${COMPONENT_RATE_LIMIT_PER_HOUR} components per hour.` }, { status: 429 })
  }

  // Atomic debit BEFORE the Claude call; refundDebit on any failure. The refund adds
  // back only this request's debit, so concurrent spends are never erased.
  const creditRef = randomUUID()
  const debit = await debitCredits(userId, COMPONENT_COST, 'custom_component', creditRef)
  if (!debit.ok) {
    if (debit.error === 'insufficient_credits') {
      return NextResponse.json({ error: `Insufficient credits. Need ${COMPONENT_COST}, have ${debit.balance ?? 0}.` }, { status: 402 })
    }
    if (debit.error === 'billing_hold') {
      return NextResponse.json({ error: BILLING_HOLD_MESSAGE, code: 'billing_hold' }, { status: 402 })
    }
    return NextResponse.json({ error: 'Failed to debit credit' }, { status: 500 })
  }

  const refund = async () => {
    await refundDebit(userId, creditRef, 'custom_component', 'custom_component_refund')
  }

  try {
    // Generate component
    const msg = await anthropic.messages.create({
      model: ITERATION_MODEL,
      max_tokens: 4096,
      system: COMPONENT_SYSTEM,
      messages: [{
        role: 'user',
        content: `Generate a React component for this request:\n\n${instruction}`,
      }],
    })

    const rawCode = msg.content[0]?.type === 'text'
      ? msg.content[0].text.trim().replace(/^```(?:tsx?|jsx?)?\n?/, '').replace(/\n?```$/, '').trim()
      : ''

    if (!rawCode) {
      await refund()
      return NextResponse.json({ error: 'Model returned empty response' }, { status: 500 })
    }

    // Validate
    const validation = validateCustomComponent(rawCode)
    if (!validation.valid) {
      await refund()
      return NextResponse.json({
        error: 'Generated component failed sandbox validation',
        validationErrors: validation.errors,
      }, { status: 422 })
    }

    // Store component
    const ref = `custom-${Date.now().toString(36)}`
    const { data: comp, error: compErr } = await supabaseAdmin
      .from('custom_components')
      .insert({
        project_id: project.id,
        ref,
        name,
        code: rawCode,
        prompt: instruction,
        passed_validation: true,
        warnings: validation.warnings,
      })
      .select()
      .single()

    if (compErr || !comp) {
      await refund()
      return NextResponse.json({ error: 'Failed to store component' }, { status: 500 })
    }

    return NextResponse.json({
      ref,
      name,
      code: rawCode,
      warnings: validation.warnings,
      section: { type: 'customComponent', ref },
      creditsUsed: COMPONENT_COST,
      balanceAfter: debit.balance,
    })
  } catch (err) {
    await refund()
    console.error('[custom-component] error:', err)
    return NextResponse.json({ error: 'Component generation failed' }, { status: 500 })
  }
}

// GET /api/quante/custom-component?projectId=xxx — list components for a project
export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const projectId = url.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const project = await getOwnedProject<{ id: string }>(projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: components } = await supabaseAdmin
    .from('custom_components')
    .select('id, ref, name, prompt, warnings, created_at')
    .eq('project_id', project.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ components: components ?? [] })
}

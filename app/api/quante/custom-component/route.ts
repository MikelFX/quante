// POST /api/quante/custom-component
// Generates a sandboxed, validated React component from an instruction.
// The component is stored in custom_components and referenced in the manifest
// via { type: 'customComponent', ref: '<ref>' }.
// Costs 3 credits.

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, ITERATION_MODEL } from '@/lib/claude'
import { validateCustomComponent } from '@/lib/sandbox/validate-component'
import { NextResponse } from 'next/server'

export const maxDuration = 120

const COMPONENT_COST = 3

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

  let body: { projectId: string; instruction: string; name?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { projectId, instruction, name = 'Custom Component' } = body
  if (!projectId || !instruction?.trim()) {
    return NextResponse.json({ error: 'projectId and instruction are required' }, { status: 400 })
  }

  // Check credits
  const supabase = await createClient()
  const { data: lastEntry } = await supabase
    .from('credit_ledger')
    .select('balance_after')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const balance = lastEntry?.balance_after ?? 0
  if (balance < COMPONENT_COST) {
    return NextResponse.json({ error: `Insufficient credits. Need ${COMPONENT_COST}, have ${balance}.` }, { status: 402 })
  }

  // Verify project ownership
  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Debit credits
  const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin
    .from('credit_ledger')
    .insert({
      user_id: userId,
      delta: -COMPONENT_COST,
      reason: 'custom_component',
      ref_id: projectId,
      balance_after: balance - COMPONENT_COST,
    })
    .select()
    .single()

  if (ledgerErr || !ledgerRow) {
    return NextResponse.json({ error: 'Failed to debit credit' }, { status: 500 })
  }

  const refund = async () => {
    await supabaseAdmin.from('credit_ledger').insert({
      user_id: userId, delta: COMPONENT_COST, reason: 'custom_component_refund',
      ref_id: ledgerRow.id, balance_after: balance,
    })
  }

  try {
    // Generate component
    const msg = await anthropic.messages.create({
      model: ITERATION_MODEL,
      max_tokens: 4096,
      system: COMPONENT_SYSTEM,
      messages: [{
        role: 'user',
        content: `Generate a React component for this request:\n\n${instruction.trim()}`,
      }],
    })

    const rawCode = msg.content[0].type === 'text'
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
        project_id: projectId,
        ref,
        name,
        code: rawCode,
        prompt: instruction.trim(),
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
      balanceAfter: balance - COMPONENT_COST,
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

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: components } = await supabaseAdmin
    .from('custom_components')
    .select('id, ref, name, prompt, warnings, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ components: components ?? [] })
}

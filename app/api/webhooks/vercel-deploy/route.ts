// POST /api/webhooks/vercel-deploy
//
// V3: auto-draft a changelog entry whenever this project's PRODUCTION
// deployment succeeds. This closes the gap where real ships (mobile pass,
// F2-F9 master build, GLS/byrd shipping, the V2 changelog fix itself, ...)
// never made it into the public /changelog because the only way in was a
// human filling out the /admin form.
//
// ── Wiring this up (not done automatically — see docs/update-log.md) ──────
// 1. Run supabase/migration-changelog-v3.sql in the Supabase SQL editor
//    BEFORE deploying this route (adds deployment_id + published columns —
//    see that file's header for why the order matters).
// 2. Vercel dashboard → Team Settings → Webhooks → Add Webhook.
//    Event: "Deployment Succeeded". Project scope: this project only.
//    This is the simple ACCOUNT-level webhook (https://vercel.com/docs/webhooks),
//    not an Integration — no Checks registration needed for this event type.
// 3. Endpoint URL: https://<your-domain>/api/webhooks/vercel-deploy
// 4. Vercel shows you a secret ONCE at creation — set it as VERCEL_WEBHOOK_SECRET
//    in the project's env vars (Production).
// 5. Send a test delivery from the Vercel dashboard and check this route's
//    logs — see the note on `meta.githubCommitMessage` below before trusting
//    the AI-drafted title/description in production.
//
// ── Payload shape ───────────────────────────────────────────────────────
// Verified against https://vercel.com/docs/webhooks/webhooks-api (fetched
// 2026-08-07) — NOT guessed. `payload.deployment.meta` itself is documented
// only as "a Map of deployment metadata" with no fixed schema; the
// `githubCommitMessage` key read via extractCommitMessage() is commonly
// observed on GitHub-linked deployments but isn't part of the contractual
// shape. If it's ever missing/renamed, this route still works correctly —
// it just falls back to a generic "Production deploy <id>" draft title
// instead of the commit message (see fallbackTitleFromDeployment).
//
// ── Idempotency (the important part) ───────────────────────────────────
// Vercel — like most webhook senders — can and does redeliver on timeout or
// retry. We INSERT a row with a UNIQUE(deployment_id) constraint BEFORE doing
// anything else, including the AI draft call. A unique-violation (Postgres
// 23505) means we already logged this exact deployment; we return 200
// immediately and treat it as success, not an error. Same insert-first-then-
// act pattern quante-fulfillment-byrd-spec.md prescribes for
// fulfillment_shipments/order_id, for the same reason: a webhook handler
// must never do the expensive/side-effecting part twice.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, INTAKE_MODEL, SYSTEM_PROMPT_CHANGELOG_DRAFT } from '@/lib/claude'
import { CHANGELOG_TAGS, slugify, type ChangelogTag } from '@/lib/changelog'
import {
  verifyVercelSignature,
  isDuplicateDeploymentError,
  extractCommitMessage,
  fallbackTitleFromDeployment,
} from '@/lib/vercel-webhook'

export const maxDuration = 30

interface VercelWebhookEvent {
  type: string
  payload: {
    deployment?: {
      id: string
      meta?: Record<string, unknown>
    }
    target?: string | null
  }
}

export async function POST(request: Request) {
  const secret = process.env.VERCEL_WEBHOOK_SECRET
  if (!secret) {
    // Not wired up yet — fail loudly in logs, but don't 500 Vercel's retry
    // logic into a frenzy; 200 + skipped is the polite response for "not
    // configured", 500 is reserved for "configured but something broke".
    console.error('[webhooks/vercel-deploy] VERCEL_WEBHOOK_SECRET not set — see route.ts header for setup steps')
    return NextResponse.json({ ok: false, skipped: 'not-configured' }, { status: 200 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-vercel-signature')
  if (!verifyVercelSignature(rawBody, signature, secret)) {
    console.error('[webhooks/vercel-deploy] invalid or missing x-vercel-signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  let event: VercelWebhookEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Only production deploy successes create a draft. Preview deploys, other
  // event types, staging, etc. are intentionally ignored (cheaply, 200 OK —
  // an ignored event is not an error and must not trigger Vercel retries).
  if (event.type !== 'deployment.succeeded' && event.type !== 'deployment.ready') {
    return NextResponse.json({ ok: true, skipped: 'event-type' })
  }
  if (event.payload.target !== 'production') {
    return NextResponse.json({ ok: true, skipped: 'not-production' })
  }

  const deployment = event.payload.deployment
  if (!deployment?.id) {
    console.error('[webhooks/vercel-deploy] payload missing deployment.id:', JSON.stringify(event.payload))
    return NextResponse.json({ error: 'Missing deployment id' }, { status: 400 })
  }

  const commitMessage = extractCommitMessage(deployment.meta)
  const fallbackTitle = fallbackTitleFromDeployment(commitMessage, deployment.id)

  // ── Idempotency guard: insert BEFORE any AI call or other side effect ───
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('changelog_entries')
    .insert({
      deployment_id: deployment.id,
      date: new Date().toISOString().slice(0, 10),
      title: fallbackTitle,
      description: 'Draft — pending admin review. Auto-created from a production deploy.',
      tags: [],
      slug: null,
      published: false,
    })
    .select('id')
    .single()

  if (insertError) {
    if (isDuplicateDeploymentError(insertError)) {
      // We've already logged this deployment (this is a redelivery). Not an error.
      return NextResponse.json({ ok: true, skipped: 'duplicate-deployment' })
    }
    // 42703 = undefined_column — the most likely cause is that
    // migration-changelog-v3.sql hasn't been run yet. Surface that plainly.
    const hint = insertError.code === '42703'
      ? ' Run supabase/migration-changelog-v3.sql before enabling this webhook.'
      : ''
    console.error('[webhooks/vercel-deploy] insert failed:', insertError.message, hint)
    return NextResponse.json({ error: `Insert failed: ${insertError.message}.${hint}` }, { status: 500 })
  }

  // ── Best-effort AI polish (never blocks the response for long, never
  //    risks a duplicate row — the draft already exists either way) ───────
  if (commitMessage) {
    try {
      const completion = await anthropic.messages.create({
        model: INTAKE_MODEL,
        max_tokens: 300,
        system: SYSTEM_PROMPT_CHANGELOG_DRAFT,
        messages: [{ role: 'user', content: commitMessage }],
      })
      const text = completion.content.find((b) => b.type === 'text')?.text ?? ''
      const cleaned = text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
      const parsed = JSON.parse(cleaned) as { title?: unknown; description?: unknown; tags?: unknown }

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
      const rawTags = Array.isArray(parsed.tags) ? parsed.tags : []
      const tags = rawTags.filter(
        (t): t is ChangelogTag => typeof t === 'string' && (CHANGELOG_TAGS as readonly string[]).includes(t),
      )

      if (title && description) {
        await supabaseAdmin
          .from('changelog_entries')
          .update({ title, description, tags, slug: slugify(title) })
          .eq('id', inserted.id)
      }
    } catch (aiError) {
      // The draft row already exists with the raw-commit-message fallback
      // title — an admin can rewrite it by hand. A failed polish pass is not
      // a failed webhook delivery.
      console.error('[webhooks/vercel-deploy] AI draft polish failed, keeping raw fallback:', aiError)
    }
  }

  return NextResponse.json({ ok: true, entryId: inserted.id, published: false })
}

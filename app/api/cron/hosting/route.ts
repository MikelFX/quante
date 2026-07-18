// GET /api/cron/hosting — daily Vercel cron (see vercel.json).
// 1. Sends expiry reminder emails 7 days and 1 day before trial/subscription end.
// 2. Suspends expired stores: deploys a white-label maintenance page to the
//    store's Vercel project and marks projects.hosting_suspended_at.
// Store data is NEVER deleted — resubscribing restores the store automatically
// (see the hosting branch of /api/stripe/webhook).

import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createPreviewDeployment, HOSTING_ROOT_DOMAIN } from '@/lib/hosting/vercel'
import { maintenanceSiteFiles } from '@/lib/hosting/maintenance-site'
import { hostingReminderEmail, hostingSuspendedEmail, sendEmail } from '@/lib/email-templates'

export const maxDuration = 300

const BILLING_FROM = 'Quante <billing@quantecode.com>'

interface ProjectRow {
  id: string
  name: string
  user_id: string
  vercel_project_id: string | null
  hosting_trial_ends_at: string
  hosting_suspended_at: string | null
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = request.headers.get('authorization') ?? ''
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const now = Date.now()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quante.vercel.app'

  // Only projects that were deployed at least once (trial timestamp set on first deploy)
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id, name, user_id, vercel_project_id, hosting_trial_ends_at, hosting_suspended_at')
    .not('hosting_trial_ends_at', 'is', null)
    .limit(500)

  if (!projects || projects.length === 0) {
    return NextResponse.json({ ok: true, reminders: 0, suspended: 0 })
  }

  const projectIds = projects.map((p) => p.id)
  const { data: subs } = await supabaseAdmin
    .from('hosting_subscriptions')
    .select('project_id, status, current_period_end, cancel_at_period_end')
    .in('project_id', projectIds)
    .in('status', ['active', 'trialing'])

  const subByProject = new Map(
    (subs ?? []).map((s) => [s.project_id as string, s]),
  )

  const { data: deploys } = await supabaseAdmin
    .from('deployments')
    .select('project_id, domain, status, created_at')
    .in('project_id', projectIds)
    .eq('status', 'ready')
    .order('created_at', { ascending: false })

  const domainByProject = new Map<string, string>()
  for (const d of deploys ?? []) {
    if (d.domain && !domainByProject.has(d.project_id as string)) {
      domainByProject.set(d.project_id as string, d.domain as string)
    }
  }

  let reminders = 0
  let suspended = 0

  for (const project of projects as ProjectRow[]) {
    const sub = subByProject.get(project.id)

    // Active auto-renewing subscription → nothing to do
    if (sub && !sub.cancel_at_period_end) continue

    const endsAtIso = sub ? (sub.current_period_end as string | null) : project.hosting_trial_ends_at
    if (!endsAtIso) continue

    const endsAt = new Date(endsAtIso).getTime()
    const daysLeft = Math.ceil((endsAt - now) / 86400000)
    const refDate = endsAtIso.slice(0, 10)
    const isTrial = !sub
    const domain = domainByProject.get(project.id) ?? null
    const storeUrl = domain ? `https://${domain}` : null
    const projectUrl = `${appUrl}/project/${project.id}`

    // ── Reminders (7d / 1d before expiry) ──────────────────────────────────
    if (daysLeft > 0 && (daysLeft <= 1 || daysLeft <= 7)) {
      const kind = daysLeft <= 1 ? 'reminder_1d' : 'reminder_7d'
      if (await claimReminder(project.id, kind, refDate)) {
        const email = await getOwnerEmail(project.user_id)
        if (email) {
          const { subject, html } = hostingReminderEmail({
            storeName: project.name,
            storeUrl,
            endsAt: endsAtIso,
            daysLeft: daysLeft <= 1 ? 1 : 7,
            isTrial,
            projectUrl,
          })
          await sendEmail(email, subject, html, BILLING_FROM)
          reminders++
        }
      }
      continue
    }

    // ── Suspension (expired, not yet suspended, store actually live) ───────
    if (daysLeft <= 0 && !project.hosting_suspended_at && project.vercel_project_id && domain) {
      try {
        const slug = domain.endsWith(`.${HOSTING_ROOT_DOMAIN}`)
          ? domain.slice(0, -(HOSTING_ROOT_DOMAIN.length + 1))
          : undefined
        await createPreviewDeployment(
          project.vercel_project_id,
          maintenanceSiteFiles(project.name),
          slug,
        )
      } catch (err) {
        console.error(`[cron/hosting] maintenance deploy failed for ${project.id}:`, err)
        continue // retry on the next run
      }

      await supabaseAdmin
        .from('projects')
        .update({ hosting_suspended_at: new Date().toISOString() })
        .eq('id', project.id)

      suspended++

      if (await claimReminder(project.id, 'suspended', refDate)) {
        const email = await getOwnerEmail(project.user_id)
        if (email) {
          const { subject, html } = hostingSuspendedEmail({
            storeName: project.name,
            storeUrl,
            projectUrl,
          })
          await sendEmail(email, subject, html, BILLING_FROM)
        }
      }
    }
  }

  return NextResponse.json({ ok: true, reminders, suspended })
}

// Inserts the dedup row; returns false when this reminder was already sent.
async function claimReminder(projectId: string, kind: string, refDate: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('hosting_reminders')
    .upsert(
      { project_id: projectId, kind, ref_date: refDate },
      { onConflict: 'project_id,kind,ref_date', ignoreDuplicates: true },
    )
    .select('id')
  if (error) {
    console.error('[cron/hosting] claimReminder error:', error)
    return false
  }
  return !!data && data.length > 0
}

async function getOwnerEmail(userId: string): Promise<string | null> {
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    return user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress
      ?? user.emailAddresses[0]?.emailAddress
      ?? null
  } catch (err) {
    console.error('[cron/hosting] failed to get owner email:', err)
    return null
  }
}

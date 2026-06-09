import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { setEnvVars } from '@/lib/hosting/vercel'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const supabase = await createClient()

  const { data: secrets } = await supabase
    .from('project_secrets')
    .select('stripe_publishable_key, stripe_secret_key')
    .eq('project_id', projectId)
    .maybeSingle()

  return NextResponse.json({
    stripePublishableKey: secrets?.stripe_publishable_key ?? '',
    stripeSecretKeySet: !!(secrets?.stripe_secret_key && !secrets.stripe_secret_key.startsWith('sk_live_replace')),
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const { stripePublishableKey, stripeSecretKey } = await request.json()

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('id, vercel_project_id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Upsert secrets
  await supabaseAdmin.from('project_secrets').upsert({
    project_id: projectId,
    user_id: userId,
    stripe_publishable_key: stripePublishableKey || null,
    stripe_secret_key: stripeSecretKey || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id' })

  // If store is deployed, push keys to Vercel env vars
  if (project.vercel_project_id) {
    const envUpdate: Record<string, string> = {}
    if (stripePublishableKey) envUpdate['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'] = stripePublishableKey
    if (stripeSecretKey) envUpdate['STRIPE_SECRET_KEY'] = stripeSecretKey

    if (Object.keys(envUpdate).length > 0) {
      try {
        await setEnvVars(project.vercel_project_id as string, envUpdate, {
          encrypted: stripeSecretKey ? ['STRIPE_SECRET_KEY'] : [],
        })
      } catch (err) {
        console.warn('[settings] setEnvVars non-fatal:', err)
      }
    }
  }

  return NextResponse.json({ ok: true })
}

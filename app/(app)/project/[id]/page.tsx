import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { StudioClient } from './StudioClient'
import type { ShopManifest } from '@/types/manifest'

interface Props {
  params: Promise<{ id: string }>
}

export default async function StudioPage({ params }: Props) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const [projectResult, manifestResult, ledgerResult] = await Promise.all([
    supabase.from('projects').select('*').eq('id', id).eq('user_id', userId).single(),
    supabase.from('manifest_versions').select('manifest').eq('project_id', id)
      .order('version_no', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('credit_ledger').select('balance_after').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  if (projectResult.error || !projectResult.data) redirect('/dashboard')

  const project = projectResult.data
  const manifest = (manifestResult.data?.manifest ?? null) as ShopManifest | null
  const balance = ledgerResult.data?.balance_after ?? 0

  return (
    <StudioClient
      projectId={id}
      projectName={project.name}
      initialManifest={manifest}
      initialBalance={balance}
    />
  )
}

// The Qads Studio surface — a sibling to the Builder/Admin StudioClient, not a mode
// inside it. StudioClient.tsx's Builder/Admin toggle is a boolean (`adminMode`) threaded
// through a very large, already-dense file; adding Qads as a third state there would
// mean touching every `adminMode ? x : y` call site for a feature that is architecturally
// unrelated to storefront building/merchant-order-management. A dedicated route keeps
// Qads's blast radius contained to its own files, and the top bar link added to
// StudioClient (see the "Ads" button next to the Builder/Admin toggle) is the nav entry
// point back and forth.

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AdsClient } from './AdsClient'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AdsPage({ params }: Props) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) redirect('/login')

  const supabase = await createClient()
  const { data: project, error } = await supabase.from('projects').select('id, name').eq('id', id).eq('user_id', userId).single()
  if (error || !project) redirect('/dashboard')

  return <AdsClient projectId={id} projectName={project.name as string} />
}

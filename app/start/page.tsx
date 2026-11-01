// /start — onboarding: who you are → what you want to do first → one short input → straight into
// the module with the form filled (lib/onboarding/model.ts). Public: the website links here before
// sign-up (/start?persona=…&goal=…); signed-out visitors sign up at the end and come back to
// /start?resume=1, which saves the answers and goes on. The dashboard sends a new, empty account
// here once; "Guide me" on the dashboard opens it again.
import { auth } from '@clerk/nextjs/server'
import { buildMetadata } from '@/lib/seo'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { asGoal, asPersona } from '@/lib/onboarding/model'
import { readSaved } from '@/lib/onboarding/server'
import { StartClient, type StartStore } from './StartClient'

export const metadata = buildMetadata({
  title: 'Get started — Quante',
  description: 'Tell us who you are and what you want to do first: ads, moving your store over or a brand new store. Quante takes you straight there.',
  path: '/start',
})

type Search = Promise<Record<string, string | string[] | undefined>>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function StartPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams
  const { userId } = await auth()

  let stores: StartStore[] = []
  let saved = null
  if (userId) {
    const [projects, record] = await Promise.all([
      supabaseAdmin
        .from('projects')
        .select('id, name')
        .eq('user_id', userId)
        .neq('status', 'archived')
        .order('updated_at', { ascending: false })
        .limit(50),
      readSaved(),
    ])
    stores = ((projects.data ?? []) as Array<{ id: string; name: string | null }>).map((p) => ({ id: p.id, name: p.name || 'Untitled store' }))
    saved = record
  }

  return (
    <StartClient
      signedIn={!!userId}
      stores={stores}
      initialPersona={asPersona(one(q.persona)) ?? saved?.persona ?? null}
      initialGoal={asGoal(one(q.goal))}
      fromLink={!!asPersona(one(q.persona)) || !!asGoal(one(q.goal))}
      resume={one(q.resume) === '1'}
    />
  )
}

// Onboarding answers on the profile (server-only). Clerk publicMetadata.onboarding is the record
// that decides whether the wizard is shown (always available, no migration); the table
// user_onboarding (supabase/migration-onboarding.sql) is a best-effort copy for queries.
import { clerkClient, currentUser } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { parseSaved, type AdKind, type SavedOnboarding } from './model'

export async function readSaved(): Promise<SavedOnboarding | null> {
  try {
    const user = await currentUser()
    return parseSaved((user?.publicMetadata as Record<string, unknown> | undefined)?.onboarding)
  } catch {
    return null
  }
}

export async function writeSaved(userId: string, saved: SavedOnboarding, adKind: AdKind | null): Promise<boolean> {
  const clerk = await clerkClient()
  // publicMetadata is merged by Clerk: other keys on the profile stay as they are.
  await clerk.users.updateUserMetadata(userId, { publicMetadata: { onboarding: saved } })

  const { error } = await supabaseAdmin.from('user_onboarding').upsert(
    {
      user_id: userId,
      persona: saved.persona,
      goal: saved.goal,
      ad_kind: saved.goal === 'ads' ? adKind : null,
      skipped: saved.skipped,
      completed_at: saved.at,
    },
    { onConflict: 'user_id' },
  )
  // 42P01 / PGRST205: the table does not exist yet (migration not run) — the Clerk copy is enough.
  if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
    console.error('[onboarding] table write failed:', error.message)
  }
  return true
}

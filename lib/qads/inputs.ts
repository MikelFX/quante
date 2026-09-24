// Qads input-photo helpers. Server-only.
//
// qads-inputs is a private bucket and every signing call uses the service role,
// so a storage path taken from a request body must be proven to be the caller's
// own before we sign it — otherwise any user could render ads from another
// tenant's private photos.

import { supabaseAdmin } from '@/lib/supabase/admin'

const INPUT_BUCKET = 'qads-inputs'
const SIGNED_URL_TTL_S = 60 * 60 * 2 // long enough for Higgsfield's initial fetch

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Exactly the shape /api/qads/upload produces: `${userId}/${ms}-${rand}.${ext}`.
// No nested segments, no '..'.
export function isOwnQadsInputPath(userId: string, path: string): boolean {
  if (!userId || typeof path !== 'string') return false
  const re = new RegExp(`^${escapeRegex(userId)}/[0-9]+-[a-z0-9]+\\.(jpg|png|webp)$`)
  return re.test(path)
}

// Signs every path; returns null if any object is missing or signing fails.
export async function signQadsInputPaths(paths: string[]): Promise<string[] | null> {
  const out: string[] = []
  for (const p of paths) {
    const { data, error } = await supabaseAdmin.storage.from(INPUT_BUCKET).createSignedUrl(p, SIGNED_URL_TTL_S)
    if (error || !data?.signedUrl) return null
    out.push(data.signedUrl)
  }
  return out
}

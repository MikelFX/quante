// Shared loader for the legacy /preview/[id]/* pages. Server-only.
//
// SECURITY: these pages render a project's latest manifest on the platform origin.
// They used to be public (any project id, no auth), which exposed unpublished stores
// and merchant bank details and let attackers host arbitrary branded content on
// quantecode.com. Only the signed-in owner may view a project's preview now.

import 'server-only'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { sanitizeManifestForRender } from '@/lib/manifest-schema'
import type { ShopManifest } from '@/types/manifest'

/**
 * Returns the latest manifest of `projectId` (or null when the project has none yet)
 * if the current user owns the project. Calls notFound() otherwise, so ownership is
 * never leaked. Deduplicated per request (layout + page share one lookup).
 */
export const loadOwnedPreviewManifest = cache(async (projectId: string): Promise<ShopManifest | null> => {
  const { userId } = await auth()
  if (!userId) notFound()

  const project = await getOwnedProject(projectId, userId)
  if (!project) notFound()

  const { data } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const manifest = (data?.manifest as ShopManifest | undefined) ?? null
  // Legacy rows may predate the palette/font render-safety rules in ShopManifestSchema —
  // re-apply them before anything reaches CSS (manifestToCssVars / buildFontUrl).
  return manifest ? sanitizeManifestForRender(manifest) : null
})

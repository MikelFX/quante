import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import {
  generateObchodniPodminky,
  generateOchranaOsobnichUdaju,
  generateCookies,
  generateKontakt,
} from '@/lib/legal-templates'
import { ShopManifestSchema } from '@/lib/manifest-schema'
import type { ShopManifest } from '@/types/manifest'

// Fix (2026-08-07): this route used supabase.auth.getUser() against the service-role
// client returned by createClient() (see lib/supabase/server.ts — Clerk handles auth,
// createClient() is just an alias for supabaseAdmin with no session). That call always
// resolved user: null, so this route unconditionally 401'd and legal-page generation was
// silently broken for every project. Swapped to Clerk's auth(), matching every sibling
// route (e.g. app/api/quante/email-test/route.ts, app/api/projects/[id]/settings/route.ts).
export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const { projectId } = await request.json()
  if (!projectId) return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Code-gen mode (2026-08-21): app/terms, app/privacy, app/cookies, app/contact are
  // always present in the scaffold (see lib/store-template/build.ts) and fetch live
  // content from app/api/store/legal, generated on the fly from the business info
  // saved on project_secrets (MerchantPanel.tsx). There's nothing to "generate" or
  // write here — the pages already exist and update automatically. This route now
  // only needs to run its legacy manifest-mode logic below for projects that predate
  // the code-gen pivot and are still on the old ShopManifest/customPages model.
  const { data: codeVersion } = await supabase
    .from('code_versions')
    .select('id')
    .eq('project_id', projectId)
    .limit(1)
    .maybeSingle()
  if (codeVersion) {
    return NextResponse.json({ ok: true, mode: 'code-gen', message: 'Legal pages are live at /terms, /privacy, /cookies, /contact and update automatically from your saved business data.' })
  }

  const { data: versionRow } = await supabase
    .from('manifest_versions')
    .select('manifest, version_no')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!versionRow?.manifest) return NextResponse.json({ error: 'No manifest found' }, { status: 404 })

  const manifest = versionRow.manifest as ShopManifest
  if (!manifest.merchant) return NextResponse.json({ error: 'Merchant data missing in manifest' }, { status: 400 })

  const m = manifest.merchant
  const legalPages = [
    {
      slug: 'obchodni-podminky',
      title: 'Obchodní podmínky',
      sections: [{ type: 'richText' as const, props: { content: generateObchodniPodminky(m, manifest.payments, manifest.shipping), align: 'left' as const } }],
    },
    {
      slug: 'ochrana-osobnich-udaju',
      title: 'Ochrana osobních údajů',
      sections: [{ type: 'richText' as const, props: { content: generateOchranaOsobnichUdaju(m, manifest.payments, manifest.shipping), align: 'left' as const } }],
    },
    {
      slug: 'cookies',
      title: 'Cookies',
      sections: [{ type: 'richText' as const, props: { content: generateCookies(m), align: 'left' as const } }],
    },
    {
      slug: 'kontakt',
      title: 'Kontakt',
      sections: [{ type: 'richText' as const, props: { content: generateKontakt(m), align: 'left' as const } }],
    },
  ]

  // Merge legal pages into existing customPages (replace if slug already exists)
  const legalSlugs = legalPages.map((p) => p.slug)
  const existingCustomPages = (manifest.customPages ?? []).filter((p) => !legalSlugs.includes(p.slug))
  const updatedManifest: ShopManifest = {
    ...manifest,
    customPages: [...existingCustomPages, ...legalPages],
    // Ensure legal links in footer column
    footer: ensureLegalFooterColumn(manifest),
  }

  const parsed = ShopManifestSchema.strip().parse(updatedManifest)

  const { error } = await supabase.from('manifest_versions').insert({
    project_id: projectId,
    version_no: versionRow.version_no + 1,
    manifest: parsed,
    prompt: 'Generování právních stránek',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId)

  return NextResponse.json({ manifest: parsed })
}

function ensureLegalFooterColumn(manifest: ShopManifest): ShopManifest['footer'] {
  const LEGAL_LINKS = [
    { label: 'Obchodní podmínky', href: '/obchodni-podminky' },
    { label: 'Ochrana osobních údajů', href: '/ochrana-osobnich-udaju' },
    { label: 'Cookies', href: '/cookies' },
    { label: 'Kontakt', href: '/kontakt' },
  ]
  const existingColumns = (manifest.footer.columns ?? []).filter((c) => c.title !== 'Právní informace')
  return {
    ...manifest.footer,
    columns: [
      ...existingColumns,
      { title: 'Právní informace', links: LEGAL_LINKS },
    ],
  }
}

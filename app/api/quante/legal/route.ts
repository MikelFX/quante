import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  generateObchodniPodminky,
  generateOchranaOsobnichUdaju,
  generateCookies,
  generateKontakt,
} from '@/lib/legal-templates'
import { ShopManifestSchema } from '@/lib/manifest-schema'
import type { ShopManifest } from '@/types/manifest'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId } = await request.json()
  if (!projectId) return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

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

import { auth } from '@clerk/nextjs/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import type { ShopManifest } from '@/types/manifest'
import { sanitizeManifestForRender } from '@/lib/manifest-schema'
import type { CodeVersionFiles } from '@/types/store-code'
import { buildStoreFiles, toStoreSlug, type GeneratedFile } from '@/lib/store-template/build'
import { isAgencyUser } from '@/lib/tier'
import { scrubBranding, agencyReadme, AGENCY_ENV_EXAMPLE } from '@/lib/export-scrub'
import { CREDIT_COSTS } from '@/lib/config'
import { getOwnedProject } from '@/lib/auth/project'
import { debitCredits, refundDebit } from '@/lib/credits'
import { hasPaidAdminPanel } from '@/app/api/quante/admin-panel/paid'

const EXPORT_COST = CREDIT_COSTS.export
const EXPORT_ADMIN_COST = CREDIT_COSTS.export_admin
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'

function applyAgencyScrub(files: GeneratedFile[], name: string): GeneratedFile[] {
  const out = scrubBranding(files)
  // Inject generic README + .env.example (overwrite any existing ones)
  const readme = { path: 'README.md', content: agencyReadme(name), encoding: 'utf-8' as const }
  const envExample = { path: '.env.example', content: AGENCY_ENV_EXAMPLE, encoding: 'utf-8' as const }
  const readmeIdx = out.findIndex((f) => f.path === 'README.md')
  if (readmeIdx >= 0) out[readmeIdx] = readme
  else out.push(readme)
  const envIdx = out.findIndex((f) => f.path === '.env.example')
  if (envIdx >= 0) out[envIdx] = envExample
  else out.push(envExample)
  return out
}

async function zipFiles(slug: string, files: GeneratedFile[]): Promise<Buffer> {
  const zip = new JSZip()
  for (const f of files) {
    zip.file(`${slug}/${f.path}`, f.content)
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: unknown; includeAdmin?: unknown }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { projectId } = body
  // Strict boolean — only a literal `true` asks for (and pays for) the admin panel.
  const includeAdmin = body.includeAdmin === true
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  // Ownership check (service-role client — RLS does not apply)
  const project = await getOwnedProject<{ id: string; name: string }>(projectId, userId, 'id, name')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const agency = await isAgencyUser(userId)

  // ── Load the content to export (before charging anything) ─────────────────
  const { data: codeVersion } = await supabaseAdmin
    .from('code_versions')
    .select('id, files, version_no')
    .eq('project_id', project.id)
    .eq('user_id', userId) // only versions the owner wrote (service-role client)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  let manifestVersion: { id: string; manifest: ShopManifest } | null = null
  let paidAdmin = false
  if (!codeVersion) {
    const { data: version } = await supabaseAdmin
      .from('manifest_versions')
      .select('id, manifest')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!version) return NextResponse.json({ error: 'No generated content found for this project.' }, { status: 404 })
    manifestVersion = version as { id: string; manifest: ShopManifest }
    // Admin files are unlocked by PAYMENT only — the stored manifest.adminPanel flag
    // is client/AI-writable and is never trusted on its own.
    paidAdmin = await hasPaidAdminPanel(userId, project.id)
  }

  // The admin add-on is charged only when it actually changes the output: legacy
  // manifest mode (code-gen buildStoreFiles has no admin files — charging there was 10
  // credits for nothing) and not already purchased via /api/quante/admin-panel.
  const chargeAdmin = !codeVersion && includeAdmin && !paidAdmin
  const cost = chargeAdmin ? EXPORT_ADMIN_COST : EXPORT_COST
  const debitReason = chargeAdmin ? 'export_admin' : 'export'

  // ── Atomic debit BEFORE building the ZIP (agency and 0-cost exports skip it) ──
  // exportId doubles as the ledger ref and the exports row id.
  const exportId = randomUUID()
  const charged = !agency && cost > 0
  if (charged) {
    const debit = await debitCredits(userId, cost, debitReason, exportId)
    if (!debit.ok) {
      if (debit.error === 'insufficient_credits') {
        return NextResponse.json(
          { error: `Insufficient credits. Need ${cost}, have ${debit.balance ?? 0}.` },
          { status: 402 }
        )
      }
      if (debit.error === 'billing_hold') {
        return NextResponse.json({ error: BILLING_HOLD_MESSAGE, code: 'billing_hold' }, { status: 402 })
      }
      return NextResponse.json({ error: 'Failed to debit credits.' }, { status: 500 })
    }
  }
  const refund = async () => {
    if (charged) await refundDebit(userId, exportId, debitReason, `${debitReason}_refund`)
  }

  let zipBuffer: Buffer
  let slug: string
  let versionId: string

  try {
    if (codeVersion) {
      // ── Code-gen mode (modern): reads from code_versions ───────────────────
      slug = toStoreSlug(project.name) || 'my-store'
      versionId = codeVersion.id
      let files = buildStoreFiles(codeVersion.files as CodeVersionFiles)
      if (agency) files = applyAgencyScrub(files, project.name)
      zipBuffer = await zipFiles(slug, files)
    } else {
      // ── Legacy manifest mode: reads from manifest_versions ─────────────────
      const mv = manifestVersion!
      versionId = mv.id
      // Agency gets the admin add-on free (see `charged`), so its stored flag is honoured
      // too — same rule as /api/export/bulk.
      const adminPanel = includeAdmin || paidAdmin || (agency && mv.manifest.adminPanel === true)
      // Legacy rows may predate the palette/font render-safety rules — re-apply them
      // before the manifest is baked into CSS in the exported store.
      const manifest = sanitizeManifestForRender({ ...mv.manifest, adminPanel } as ShopManifest)
      slug = toStoreSlug(manifest.brand.name) || 'my-store'

      const { data: customComponents } = await supabaseAdmin
        .from('custom_components')
        .select('ref, name, code')
        .eq('project_id', project.id)

      let files = buildStoreFiles(manifest, customComponents ?? [])
      if (agency) files = applyAgencyScrub(files, manifest.brand.name)
      zipBuffer = await zipFiles(slug, files)
    }
  } catch (err) {
    console.error(`Export ZIP build failed (${codeVersion ? 'code-gen' : 'manifest'} mode):`, err)
    await refund()
    return NextResponse.json({ error: 'Failed to build export ZIP.' }, { status: 500 })
  }

  // Record export (id = the ledger ref of the debit above)
  const { error: exportErr } = await supabaseAdmin
    .from('exports')
    .insert({ id: exportId, project_id: project.id, version_id: versionId, size_bytes: zipBuffer.byteLength })
  if (exportErr) console.error('[export] failed to record export:', exportErr.message)

  return new Response(new Uint8Array(zipBuffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}.zip"`,
      'Content-Length': String(zipBuffer.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}

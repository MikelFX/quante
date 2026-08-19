// GET /api/quante/generate/status?jobId=<uuid>
//
// Level 3's polling endpoint — the only channel a client has into a generation running via
// /api/quante/generate's after()-scheduled background work (see the architecture comment
// there and in docs/update-log.md). Reads through the user-scoped Supabase client, so RLS
// (see supabase/migration-generation-jobs.sql) is the actual access control: a jobId that
// exists but belongs to someone else looks identical to one that doesn't exist at all
// (both come back as "no row"), which is the correct, non-enumerable behavior for a
// client-facing status lookup.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import type { JobStatusPayload } from '@/lib/generation-poll'

const RAW_OUTPUT_TAIL_CHARS = 3000

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')?.trim()
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required.' }, { status: 400 })
  }

  const supabase = await createClient()
  // Two-step select: try with deploy_error first, fall back if the column doesn't exist
  // (migration not yet applied on this environment). Same defensive pattern as the writer
  // in /api/quante/generate/route.ts's generation_jobs completion update.
  const baseColumns = 'status, phase, raw_output, files, summary, error, project_id, deployment_id, preview_url, code_version_id'
  interface JobRow {
    status: JobStatusPayload['status']
    phase: JobStatusPayload['phase']
    raw_output: string | null
    files: Record<string, string> | null
    summary: string | null
    error: string | null
    project_id: string | null
    deployment_id: string | null
    preview_url: string | null
    code_version_id: string | null
    deploy_error?: string | null
  }
  let job: JobRow | null = null
  let queryError: unknown = null

  {
    const res = await supabase
      .from('generation_jobs')
      .select(`${baseColumns}, deploy_error`)
      .eq('id', jobId)
      .maybeSingle()
    job = (res.data as unknown as JobRow | null) ?? null
    queryError = res.error
  }
  if (queryError) {
    console.warn('[generate/status] deploy_error column missing, retrying without:', queryError)
    const res = await supabase
      .from('generation_jobs')
      .select(baseColumns)
      .eq('id', jobId)
      .maybeSingle()
    job = (res.data as unknown as JobRow | null) ?? null
    queryError = res.error
  }

  if (queryError) {
    console.error('[generate/status] query failed:', queryError)
    return NextResponse.json({ error: 'Could not load generation status.' }, { status: 500 })
  }
  if (!job) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
  }

  const payload: JobStatusPayload = {
    status: job.status,
    phase: job.phase,
    files: job.files ?? {},
    rawOutputTail: (job.raw_output ?? '').slice(-RAW_OUTPUT_TAIL_CHARS),
    summary: job.summary,
    error: job.error,
    projectId: job.project_id,
    deploymentId: job.deployment_id,
    previewUrl: job.preview_url,
    codeVersionId: job.code_version_id,
    deployError: job.deploy_error ?? null,
  }

  return NextResponse.json(payload)
}
